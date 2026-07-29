import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  authConfig,
  clearAccountSession,
  getAccountAccessToken,
  isAuthSession,
  setAccountSession,
  supabaseRequest,
} from "../server-session";
import { rejectCrossSiteMutation } from "../../csrf";

const secure = process.env.NODE_ENV === "production";
const guestCookie = secure ? "__Host-ludico_guest" : "ludico_guest";

export async function GET() {
  if (!authConfig()) return json({ configured: false, email: null });
  try {
    const token = await getAccountAccessToken();
    if (!token) return json({ configured: true, email: null });
    const response = await supabaseRequest("/auth/v1/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user: unknown = response.ok ? await response.json() : null;
    const email = readEmail(user);
    if (!email) await clearAccountSession();
    const migration = email ? await migrateGuest(token) : "not_needed";
    return json({ configured: true, email, migration });
  } catch {
    return json({ configured: true, email: null }, 503);
  }
}

export async function POST(request: NextRequest) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  if (!authConfig()) return json({ code: "AUTH_UNAVAILABLE" }, 503);
  const body: unknown = await request.json().catch(() => null);
  if (!isCredentials(body)) return json({ code: "INVALID_CREDENTIALS" }, 400);
  const path = body.action === "sign-in" ? "/auth/v1/token?grant_type=password" : "/auth/v1/signup";
  try {
    const response = await supabaseRequest(path, {
      method: "POST",
      body: JSON.stringify({ email: body.email, password: body.password }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) return json({ code: "INVALID_CREDENTIALS" }, 401);
    if (!isAuthSession(result)) return json({ status: "confirmation_required" }, 202);
    const migration = await migrateGuest(result.access_token);
    if (migration === "pending") return json({ code: "MIGRATION_PENDING" }, 503);
    await setAccountSession(result);
    return json({
      email: readEmail(result.user) ?? body.email,
      migration,
      status: "authenticated",
    });
  } catch {
    return json({ code: "AUTH_UNAVAILABLE" }, 503);
  }
}

export async function DELETE(request: NextRequest) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  try {
    const token = await getAccountAccessToken();
    if (token) {
      await supabaseRequest("/auth/v1/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch {
    // Local logout still revokes the browser session when the provider is unavailable.
  }
  await clearAccountSession();
  return new NextResponse(null, { status: 204 });
}

async function migrateGuest(accessToken: string): Promise<"migrated" | "not_needed" | "pending"> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(guestCookie)?.value;
  if (!guestToken) return "not_needed";
  try {
    const response = await fetch(`${apiUrl()}/auth/migrate-guest`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "idempotency-key": crypto.randomUUID(),
        "x-guest-token": guestToken,
      },
    });
    if (!response.ok) return "pending";
    cookieStore.delete(guestCookie);
    return "migrated";
  } catch {
    return "pending";
  }
}

function isCredentials(
  value: unknown,
): value is { action: "sign-in" | "sign-up"; email: string; password: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "action" in value &&
    (value.action === "sign-in" || value.action === "sign-up") &&
    "email" in value &&
    typeof value.email === "string" &&
    value.email.includes("@") &&
    "password" in value &&
    typeof value.password === "string" &&
    value.password.length >= 8
  );
}

function readEmail(value: unknown): string | null {
  return typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof value.email === "string"
    ? value.email
    : null;
}

function apiUrl(): string {
  return process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
