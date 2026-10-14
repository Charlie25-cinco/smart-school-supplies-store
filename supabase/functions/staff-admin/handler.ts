import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { validateAccountRequest } from "./validation.ts";

export interface HandlerOptions {
  url: string;
  publicKey: string;
  secret: string;
  origins: string[];
  fetch?: typeof globalThis.fetch;
}

/** Serialize Auth/profile changes per target. Never log credentials or input. */
export function createAccountHandler(options: HandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin"),
      allowed = Boolean(origin && options.origins.includes(origin));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Vary": "Origin",
    };
    if (allowed) {
      headers["Access-Control-Allow-Origin"] = origin!;
      headers["Access-Control-Allow-Headers"] =
        "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const response = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed) {
      return response(403, {
        error: "This application origin is not permitted.",
      });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers });
    }
    if (request.method !== "POST") {
      return response(405, { error: "Use the account-management form." });
    }
    if (Number(request.headers.get("Content-Length") || 0) > 4096) {
      return response(413, { error: "Account request is too large." });
    }
    try {
      const token = request.headers.get("Authorization")?.match(
        /^Bearer ([A-Za-z0-9._-]+)$/,
      )?.[1];
      if (!token) {
        return response(401, { error: "Sign in as an active Admin." });
      }
      const scoped = createClient(options.url, options.publicKey, {
        global: {
          headers: { Authorization: "Bearer " + token },
          fetch: options.fetch,
        },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: identity, error: identityError } = await scoped.auth
        .getUser(token);
      if (identityError || !identity.user) {
        return response(401, { error: "Sign in as an active Admin." });
      }
      const { data: actor, error: actorError } = await scoped.from("profiles")
        .select("id,role,active").eq("auth_id", identity.user.id).single();
      if (actorError || actor?.role !== "admin" || !actor.active) {
        return response(403, {
          error: "Only active Admins manage Cashier accounts.",
        });
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 4096) {
        return response(413, { error: "Account request is too large." });
      }
      let input;
      try {
        input = validateAccountRequest(JSON.parse(text));
      } catch (error) {
        return response(422, {
          error: error instanceof Error
            ? error.message
            : "Enter valid account details.",
        });
      }
      const server = createClient(options.url, options.secret, {
        global: { fetch: options.fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (input.action === "create") {
        const { data: created, error } = await server.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true,
        });
        if (error || !created.user) {
          return response(422, {
            error:
              "The Cashier account could not be created. Check the email and password requirements.",
          });
        }
        const saved = await server.from("profiles").insert({
          auth_id: created.user.id,
          name: input.name,
          email: input.email,
          role: "cashier",
          active: true,
        });
        if (saved.error) {
          if (saved.error.code !== "23505") {
            return response(503, {
              error:
                "Account creation is uncertain. Inspect Auth and the Cashier profile privately before retrying.",
            });
          }
          await server.auth.admin.deleteUser(created.user.id);
          return response(422, {
            error:
              "The Cashier profile could not be saved. The email may already be in use.",
          });
        }
        return response(200, { ok: true });
      }
      const started = await scoped.rpc("begin_staff_operation", {
        p_staff_id: input.staff_id,
      });
      if (started.error || typeof started.data !== "string") {
        return response(409, {
          error:
            "This Cashier account is unavailable or another change is still running. Retry after checking the account.",
        });
      }
      let result: Response;
      let retainGuard = false;
      try {
        result = await (async () => {
          const { data: target, error } = await server.from("profiles").select(
            "id,auth_id,name,email,role,active",
          ).eq("id", input.staff_id).single();
          if (error || target?.role !== "cashier" || !target.auth_id) {
            return response(403, { error: "Select a linked Cashier account." });
          }
          if (input.action === "edit") {
            const changed = await server.auth.admin.updateUserById(
              target.auth_id,
              { email: input.email, email_confirm: true },
            );
            if (changed.error) {
              retainGuard = !changed.error.status ||
                changed.error.status >= 500;
              return response(422, {
                error: "The Cashier email could not be updated.",
              });
            }
            const saved = await server.from("profiles").update({
              name: input.name,
              email: input.email,
              updated_at: new Date().toISOString(),
            }).eq("id", target.id).eq("role", "cashier").select("id").single();
            if (saved.error) {
              if (saved.error.code !== "23505") {
                retainGuard = true;
                return response(503, {
                  error:
                    "The profile update is uncertain. Private administrator inspection is required before retrying.",
                });
              }
              const restored = await server.auth.admin.updateUserById(
                target.auth_id,
                { email: target.email, email_confirm: true },
              );
              retainGuard = Boolean(restored.error);
              return response(422, {
                error: restored.error
                  ? "The profile update failed and email recovery needs private administrator inspection."
                  : "The Cashier profile could not be updated; its previous email was restored.",
              });
            }
          } else if (input.action === "password") {
            const revoked = await server.rpc("revoke_staff_sessions", {
              p_staff_id: target.id,
            });
            if (revoked.error) {
              retainGuard = true;
              return response(503, {
                error:
                  "The password was not changed because session revocation did not complete. Retry after checking the cloud connection.",
              });
            }
            const changed = await server.auth.admin.updateUserById(
              target.auth_id,
              { password: input.password },
            );
            if (changed.error) {
              retainGuard = !changed.error.status ||
                changed.error.status >= 500;
              if (retainGuard) {
                return response(503, {
                  error:
                    "Sessions were revoked, but the password update is uncertain. Inspect the account privately before retrying.",
                });
              }
              return response(422, {
                error:
                  "Sessions were revoked, but the password could not be changed. The Cashier can sign in again with the prior password; retry the reset when available.",
              });
            }
          } else {
            if (input.active) {
              const revoked = await server.rpc("revoke_staff_sessions", {
                p_staff_id: target.id,
              });
              if (revoked.error) {
                retainGuard = true;
                return response(503, {
                  error:
                    "Access was not re-enabled because session revocation did not complete.",
                });
              }
            }
            const saved = await server.from("profiles").update({
              active: input.active,
              updated_at: new Date().toISOString(),
            }).eq("id", target.id).eq("role", "cashier").select("id").single();
            if (saved.error) {
              retainGuard = true;
              return response(422, {
                error: "The account status could not be updated.",
              });
            }
            if (!input.active) {
              const revoked = await server.rpc("revoke_staff_sessions", {
                p_staff_id: target.id,
              });
              if (revoked.error) {
                retainGuard = true;
                return response(503, {
                  error: "Access is disabled; session cleanup must be retried.",
                });
              }
            }
          }
          return response(200, { ok: true });
        })();
      } catch {
        retainGuard = true;
        result = response(503, {
          error:
            "The account change did not finish. Check its current state before retrying.",
        });
      }
      if (retainGuard) {
        const body = await result.json();
        return response(503, {
          error: body.error +
            " Inspect the current account state privately before releasing its operation guard.",
        });
      }
      const finished = await server.rpc("finish_staff_operation", {
        p_staff_id: input.staff_id,
        p_operation_id: started.data,
      });
      if (finished.error) {
        return response(503, {
          error:
            "The account change requires private administrator recovery before another change can run.",
        });
      }
      return result;
    } catch {
      return response(503, {
        error:
          "Account management is unavailable. Try again after checking the cloud connection.",
      });
    }
  };
}
