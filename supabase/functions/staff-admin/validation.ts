export type AccountRequest = {
  action: "create" | "edit" | "password" | "active";
  staff_id?: number;
  name?: string;
  email?: string;
  password?: string;
  password_confirmation?: string;
  active?: boolean;
};
export function validateAccountRequest(input: unknown): AccountRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Enter valid account details.");
  }
  const data = input as Record<string, unknown>;
  const keys: Record<string, string[]> = {
    create: ["action", "name", "email", "password", "password_confirmation"],
    edit: ["action", "staff_id", "name", "email"],
    password: ["action", "staff_id", "password", "password_confirmation"],
    active: ["action", "staff_id", "active"],
  };
  if (
    typeof data.action !== "string" || !Object.hasOwn(keys, data.action) ||
    Object.keys(data).some((key) => !keys[data.action as string].includes(key))
  ) throw new Error("This account action is unavailable.");
  if (
    data.action !== "create" &&
    (!Number.isSafeInteger(data.staff_id) || Number(data.staff_id) < 1)
  ) throw new Error("Select a valid Cashier account.");
  if (data.action === "create" || data.action === "edit") {
    if (
      typeof data.name !== "string" || !data.name.trim() ||
      data.name.length > 100
    ) throw new Error("Enter a name of up to 100 characters.");
    if (
      typeof data.email !== "string" || data.email.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
    ) throw new Error("Enter a valid email address.");
    data.name = data.name.trim();
    data.email = data.email.trim().toLowerCase();
  }
  if (data.action === "create" || data.action === "password") {
    if (
      typeof data.password !== "string" || [...data.password].length < 12 ||
      new TextEncoder().encode(data.password).byteLength > 72 ||
      data.password !== data.password_confirmation
    ) {
      throw new Error(
        "Enter matching passwords of at least 12 characters and at most 72 UTF-8 bytes.",
      );
    }
  }
  if (data.action === "active" && typeof data.active !== "boolean") {
    throw new Error("Select whether this account is active.");
  }
  return data as AccountRequest;
}
