import { createAccountHandler } from "./handler.ts";

Deno.serve(createAccountHandler({
  url: Deno.env.get("SUPABASE_URL") || "",
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  secret: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  origins: (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) =>
    value.trim()
  ).filter(Boolean),
}));
