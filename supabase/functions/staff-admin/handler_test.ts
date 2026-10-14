import { createAccountHandler } from "./handler.ts";

const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
const fixtureId = "11111111-1111-4111-8111-111111111111";
type Settings = {
  role?: string;
  active?: boolean;
  failed?: string;
  uncertain?: string;
  denyIdentity?: boolean;
  lock?: boolean;
};
function fixture(settings: Settings = {}) {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  const mocked: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method || "GET",
      body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, method, body });
    const failure = settings.failed === url.pathname + ":" + method;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (settings.uncertain === url.pathname + ":" + method) {
      return json({
        code: "fixture_uncertain",
        message: "Fictional interrupted response",
      }, 503);
    }
    if (failure) {
      return json({
        code: url.pathname === "/rest/v1/profiles"
          ? "23505"
          : "fixture_failure",
        message: "Fixture failure",
      }, 400);
    }
    if (url.pathname === "/auth/v1/user") {
      return settings.denyIdentity
        ? json({ message: "Denied" }, 401)
        : json({ id: fixtureId, email: "admin@example.invalid" });
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (method !== "GET") return json({ id: 2 });
      return url.searchParams.has("auth_id")
        ? json({
          id: 1,
          role: settings.role || "admin",
          active: settings.active ?? true,
        })
        : json({
          id: 2,
          auth_id: "22222222-2222-4222-8222-222222222222",
          role: "cashier",
          active: true,
          name: "Fixture",
          email: "old@example.invalid",
        });
    }
    if (url.pathname === "/rest/v1/rpc/begin_staff_operation") {
      return settings.lock
        ? json({ code: "P0001", message: "Already locked" }, 400)
        : json(fixtureId);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) return json(null);
    if (url.pathname.startsWith("/auth/v1/admin/users")) {
      return json({
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "fixture@example.invalid",
        },
      });
    }
    throw new Error("Unexpected fixture endpoint");
  };
  const handler = createAccountHandler({
    url: "https://fixture.supabase.co",
    publicKey: "sb_publishable_fixture",
    secret: "sb_secret_fixture",
    origins: ["https://store.example.invalid"],
    fetch: mocked,
  });
  const request = (
    body: unknown,
    headers: Record<string, string> = {
      Authorization: "Bearer fixture.token.value",
      Origin: "https://store.example.invalid",
    },
  ) =>
    handler(
      new Request("https://fixture.supabase.co/functions/v1/staff-admin", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { calls, handler, request };
}
const create = {
  action: "create",
  name: "Fictional Cashier",
  email: "cashier@example.invalid",
  password: "Fictional-12345",
  password_confirmation: "Fictional-12345",
};
Deno.test("guest, foreign origin, invalid identity, Cashier and inactive Admin cannot manage accounts", async () => {
  for (
    const settings of [{ denyIdentity: true }, { role: "cashier" }, {
      active: false,
    }]
  ) {
    const f = fixture(settings);
    assert((await f.request(create)).status >= 400);
    assert(!f.calls.some((call) => call.path.startsWith("/auth/v1/admin/")));
  }
  const f = fixture();
  assert((await f.request(create, {})).status === 401);
  assert(
    (await f.request(create, {
      Authorization: "Bearer x",
      Origin: "https://evil.example.invalid",
    })).status === 403,
  );
  assert(f.calls.length === 0);
});
Deno.test("validated create saves only Cashier and cleans up only its newly created orphan", async () => {
  const valid = fixture();
  assert((await valid.request(create)).status === 200);
  const profile = valid.calls.find((call) =>
    call.path === "/rest/v1/profiles" && call.method === "POST"
  )!;
  assert(profile.body.role === "cashier" && !("password" in profile.body));
  const failed = fixture({ failed: "/rest/v1/profiles:POST" });
  assert((await failed.request(create)).status === 422);
  assert(failed.calls.filter((call) => call.method === "DELETE").length === 1);
  const invalid = fixture();
  assert((await invalid.request({ ...create, role: "admin" })).status === 422);
  assert(
    !invalid.calls.some((call) => call.path.startsWith("/auth/v1/admin/")),
  );
});
Deno.test("account serialization stops overlapping changes and always finalizes a acquired operation", async () => {
  const blocked = fixture({ lock: true });
  assert(
    (await blocked.request({
      action: "edit",
      staff_id: 2,
      name: "New",
      email: "new@example.invalid",
    })).status === 409,
  );
  assert(
    !blocked.calls.some((call) => call.path.startsWith("/auth/v1/admin/")),
  );
  const f = fixture();
  assert(
    (await f.request({
      action: "edit",
      staff_id: 2,
      name: "New",
      email: "new@example.invalid",
    })).status === 200,
  );
  assert(f.calls.at(-1)!.path.endsWith("/finish_staff_operation"));
});
Deno.test("profile failure rolls back the Auth email while holding the account operation", async () => {
  const f = fixture({ failed: "/rest/v1/profiles:PATCH" });
  assert(
    (await f.request({
      action: "edit",
      staff_id: 2,
      name: "New",
      email: "new@example.invalid",
    })).status === 422,
  );
  const edits = f.calls.filter((call) =>
    call.path.startsWith("/auth/v1/admin/") && call.method === "PUT"
  );
  assert(edits.length === 2 && edits[1].body.email === "old@example.invalid");
  assert(f.calls.at(-1)!.path.endsWith("/finish_staff_operation"));
});
Deno.test("reset revokes before password update and never updates when revocation fails", async () => {
  const body = {
    action: "password",
    staff_id: 2,
    password: create.password,
    password_confirmation: create.password,
  };
  const f = fixture();
  assert((await f.request(body)).status === 200);
  const revoke = f.calls.findIndex((call) =>
      call.path.endsWith("/revoke_staff_sessions")
    ),
    update = f.calls.findIndex((call) =>
      call.path.startsWith("/auth/v1/admin/") && call.method === "PUT"
    );
  assert(revoke >= 0 && update > revoke);
  const failed = fixture({ failed: "/rest/v1/rpc/revoke_staff_sessions:POST" });
  assert((await failed.request(body)).status === 503);
  assert(!failed.calls.some((call) => call.path.startsWith("/auth/v1/admin/")));
});
Deno.test("reactivation revokes old sessions first and fails closed when cleanup fails", async () => {
  const f = fixture();
  assert(
    (await f.request({ action: "active", staff_id: 2, active: true }))
      .status === 200,
  );
  assert(
    f.calls.findIndex((call) => call.path.endsWith("/revoke_staff_sessions")) <
      f.calls.findIndex((call) => call.method === "PATCH"),
  );
  const failed = fixture({ failed: "/rest/v1/rpc/revoke_staff_sessions:POST" });
  assert(
    (await failed.request({ action: "active", staff_id: 2, active: true }))
      .status === 503,
  );
  assert(!failed.calls.some((call) => call.method === "PATCH"));
});
Deno.test("disable remains applied if session cleanup fails and reports that outcome", async () => {
  const f = fixture({ failed: "/rest/v1/rpc/revoke_staff_sessions:POST" });
  const result = await f.request({
    action: "active",
    staff_id: 2,
    active: false,
  });
  assert(result.status === 503);
  assert(
    f.calls.some((call) =>
      call.method === "PATCH" && call.body.active === false
    ),
  );
  assert((await result.json()).error.includes("disabled"));
});
Deno.test("operation cleanup failure never claims completed success", async () => {
  const f = fixture({ failed: "/rest/v1/rpc/finish_staff_operation:POST" });
  assert(
    (await f.request({ action: "active", staff_id: 2, active: true }))
      .status === 503,
  );
});

Deno.test("uncertain Auth update retains its operation guard for private recovery", async () => {
  const f = fixture({
    uncertain: "/auth/v1/admin/users/22222222-2222-4222-8222-222222222222:PUT",
  });
  assert(
    (await f.request({
      action: "edit",
      staff_id: 2,
      name: "New",
      email: "new@example.invalid",
    })).status === 503,
  );
  assert(
    !f.calls.some((call) => call.path.endsWith("/finish_staff_operation")),
  );
});
Deno.test("uncertain profile response cannot trigger a blind Auth rollback or release", async () => {
  const f = fixture({ uncertain: "/rest/v1/profiles:PATCH" });
  assert(
    (await f.request({
      action: "edit",
      staff_id: 2,
      name: "New",
      email: "new@example.invalid",
    })).status === 503,
  );
  assert(
    f.calls.filter((call) =>
      call.path.startsWith("/auth/v1/admin/") && call.method === "PUT"
    ).length === 1,
  );
  assert(
    !f.calls.some((call) => call.path.endsWith("/finish_staff_operation")),
  );
});
Deno.test("uncertain new-profile response never deletes a possibly linked Auth user", async () => {
  const f = fixture({ uncertain: "/rest/v1/profiles:POST" });
  assert((await f.request(create)).status === 503);
  assert(!f.calls.some((call) => call.method === "DELETE"));
});
