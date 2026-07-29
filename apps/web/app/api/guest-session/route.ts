import type { GuestSessionCredential } from "@ludico/contracts";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { rejectCrossSiteMutation } from "../csrf";

const secure = process.env.NODE_ENV === "production";
const cookieName = secure ? "__Host-ludico_guest" : "ludico_guest";

export async function POST(request: NextRequest) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const cookieStore = await cookies();
  if (cookieStore.has(cookieName)) {
    return noStoreJson({ status: "ready" });
  }

  const response = await fetch(`${apiUrl()}/guest-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin: "web" }),
    cache: "no-store",
  });
  if (!response.ok) return noStoreJson({ status: "local-only" }, 503);

  const credential = (await response.json()) as GuestSessionCredential;
  if (!isCredential(credential)) return noStoreJson({ status: "local-only" }, 502);

  cookieStore.set(cookieName, credential.token, {
    expires: new Date(credential.expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  });
  return noStoreJson({ guestSessionId: credential.guestSessionId, status: "created" }, 201);
}

export async function DELETE(request: NextRequest) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (token) {
    await fetch(`${apiUrl()}/guest-sessions/current`, {
      method: "DELETE",
      headers: { "x-guest-token": token },
      cache: "no-store",
    }).catch(() => undefined);
  }
  cookieStore.delete(cookieName);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}

function apiUrl(): string {
  return process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

function isCredential(value: GuestSessionCredential): boolean {
  return (
    typeof value.guestSessionId === "string" &&
    typeof value.token === "string" &&
    value.token.length >= 43 &&
    !Number.isNaN(Date.parse(value.expiresAt))
  );
}

function noStoreJson(body: object, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Pragma: "no-cache" },
  });
}
