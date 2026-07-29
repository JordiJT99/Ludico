import { NextResponse, type NextRequest } from "next/server";

export function rejectCrossSiteMutation(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin === expectedOrigin(request)) return null;
  } else if (request.headers.get("sec-fetch-site") === "same-origin") {
    return null;
  }
  return NextResponse.json(
    { code: "CSRF_REJECTED" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

function expectedOrigin(request: NextRequest): string {
  if (process.env.PUBLIC_WEB_URL) {
    try {
      return new URL(process.env.PUBLIC_WEB_URL).origin;
    } catch {
      // Startup configuration checks own the malformed-value error in production.
    }
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.slice(0, -1);
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
}
