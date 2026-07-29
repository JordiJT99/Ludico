import type { ExternalIdentity } from "@ludico/database";

export interface SupabaseAuthConfig {
  readonly publishableKey: string;
  readonly url: string;
}

export class AuthProviderUnavailableError extends Error {}

export const adminRoles = [
  "superadmin",
  "editor",
  "moderator",
  "analyst",
  "support",
  "read_only",
] as const;
export type AdminRole = (typeof adminRoles)[number];
export interface AdminPrincipal {
  readonly reauthenticatedAt: string | null;
  readonly role: AdminRole;
  readonly userId: string;
}

export async function verifySupabaseAccessToken(
  token: string,
  config: SupabaseAuthConfig,
  request: typeof fetch = fetch,
): Promise<ExternalIdentity | null> {
  const body = await fetchSupabaseUser(token, config, request);
  if (!body || typeof body.id !== "string" || typeof body.email !== "string") return null;
  return { email: body.email, provider: "supabase", subject: body.id };
}

export async function verifySupabaseAdminAccessToken(
  token: string,
  config: SupabaseAuthConfig,
  request: typeof fetch = fetch,
): Promise<AdminPrincipal | null> {
  const body = await fetchSupabaseUser(token, config, request);
  if (!body || typeof body.id !== "string" || !isRecord(body.app_metadata)) return null;
  const role = body.app_metadata.admin_role;
  if (typeof role !== "string" || !adminRoles.includes(role as AdminRole)) return null;
  const reauthenticatedAt = body.app_metadata.admin_reauthenticated_at;
  return {
    reauthenticatedAt: typeof reauthenticatedAt === "string" ? reauthenticatedAt : null,
    role: role as AdminRole,
    userId: body.id,
  };
}

async function fetchSupabaseUser(
  token: string,
  config: SupabaseAuthConfig,
  request: typeof fetch,
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await request(`${config.url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AuthProviderUnavailableError("El proveedor de identidad no responde");
  }
  if (response.status >= 500) {
    throw new AuthProviderUnavailableError("El proveedor de identidad no está disponible");
  }
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return isRecord(body) ? body : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
