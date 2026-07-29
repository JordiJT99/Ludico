import { cookies } from "next/headers";

const secure = process.env.NODE_ENV === "production";
const accessCookie = secure ? "__Host-ludico_access" : "ludico_access";
const refreshCookie = secure ? "__Host-ludico_refresh" : "ludico_refresh";

interface AuthSessionResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user?: { email?: string };
}

export async function getAccountAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(accessCookie)?.value;
  if (accessToken) return accessToken;
  const refreshToken = cookieStore.get(refreshCookie)?.value;
  if (!refreshToken) return null;

  const response = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    await clearAccountSession();
    return null;
  }
  const session: unknown = await response.json();
  if (!isAuthSession(session)) {
    await clearAccountSession();
    return null;
  }
  await setAccountSession(session);
  return session.access_token;
}

export async function setAccountSession(session: AuthSessionResponse): Promise<void> {
  const cookieStore = await cookies();
  const options = { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
  cookieStore.set(accessCookie, session.access_token, {
    ...options,
    maxAge: Math.max(60, session.expires_in - 30),
  });
  cookieStore.set(refreshCookie, session.refresh_token, { ...options, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearAccountSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(accessCookie);
  cookieStore.delete(refreshCookie);
}

export function supabaseRequest(path: string, init: RequestInit): Promise<Response> {
  const config = authConfig();
  if (!config) throw new Error("AUTH_UNAVAILABLE");
  return fetch(`${config.url.replace(/\/$/, "")}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.key,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

export function authConfig(): { key: string; url: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { key, url } : null;
}

export function isAuthSession(value: unknown): value is AuthSessionResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "access_token" in value &&
    typeof value.access_token === "string" &&
    "refresh_token" in value &&
    typeof value.refresh_token === "string" &&
    "expires_in" in value &&
    typeof value.expires_in === "number"
  );
}
