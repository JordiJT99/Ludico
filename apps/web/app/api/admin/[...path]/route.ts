import { NextResponse, type NextRequest } from "next/server";
import { getAccountAccessToken } from "../../auth/server-session";
import { rejectCrossSiteMutation } from "../../csrf";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const readPath =
  /^(analytics\/dashboard|audit|blocked-terms|content(?:\/health)?|editions\/calendar|publication-settings|word-bank)$/;
const reviewPath = new RegExp(`^content/${uuid}/(approve|regenerate|reject)$`, "i");
const revisionPath = new RegExp(`^content/${uuid}$`, "i");
const previewPath = new RegExp(`^content/${uuid}/preview[.]svg$`, "i");
const blockedTermPath = new RegExp(`^blocked-terms/${uuid}/deactivate$`, "i");
const wordBankPath = new RegExp(`^word-bank/${uuid}/deactivate$`, "i");
const editionSchedulePath = new RegExp(`^editions/${uuid}/schedule$`, "i");
type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const path = (await context.params).path.join("/");
  if (!readPath.test(path) && !previewPath.test(path)) return notFound();
  return proxy(request, path, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (
    path !== "blocked-terms" &&
    path !== "content/plan" &&
    path !== "word-bank" &&
    !blockedTermPath.test(path) &&
    !editionSchedulePath.test(path) &&
    !wordBankPath.test(path) &&
    !reviewPath.test(path)
  ) {
    return notFound();
  }
  return proxy(request, path, "POST");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (path !== "publication-settings" && !revisionPath.test(path)) return notFound();
  return proxy(request, path, "PATCH");
}

async function proxy(request: NextRequest, path: string, method: "GET" | "PATCH" | "POST") {
  const accessToken = await getAccountAccessToken();
  if (!accessToken) return json({ code: "ACCOUNT_REQUIRED" }, 401);
  try {
    const response = await fetch(
      `${apiUrl()}/admin/${path}${method === "GET" ? request.nextUrl.search : ""}`,
      {
        method,
        body: method === "GET" ? undefined : await request.text(),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(method !== "GET"
            ? {
                "Content-Type": "application/json",
                "idempotency-key": crypto.randomUUID(),
              }
            : {}),
        },
      },
    );
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return json({ code: "API_UNAVAILABLE" }, 503);
  }
}

function apiUrl(): string {
  return process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

function json(body: object, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function notFound() {
  return json({ code: "NOT_FOUND" }, 404);
}
