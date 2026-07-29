import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountAccessToken } from "../../auth/server-session";
import { rejectCrossSiteMutation } from "../../csrf";

const secure = process.env.NODE_ENV === "production";
const cookieName = secure ? "__Host-ludico_guest" : "ludico_guest";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const publicGamePath = new RegExp(`^games/${uuid}$`, "i");
const startPath = new RegExp(`^games/${uuid}/attempts$`, "i");
const progressPath = new RegExp(`^attempts/${uuid}/progress$`, "i");
const hintPath = new RegExp(`^attempts/${uuid}/hints$`, "i");
const submitPath = new RegExp(`^attempts/${uuid}/submit$`, "i");
const reviewPath = new RegExp(`^attempts/${uuid}/review$`, "i");
const leaderboardPath = new RegExp(
  `^leaderboards/(game/${uuid}|(daily|weekly)/[0-9]{4}-[0-9]{2}-[0-9]{2})$`,
  "i",
);
const profilePath =
  /^me\/(data-export|streaks|leaderboard-settings|notification-preferences|previous-results)$/;
const consentReadPath = /^consents\/current$/;

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const path = (await context.params).path.join("/");
  if (publicGamePath.test(path)) return proxy(path, { method: "GET", cache: "no-store" });
  if (
    !reviewPath.test(path) &&
    !leaderboardPath.test(path) &&
    !profilePath.test(path) &&
    !consentReadPath.test(path)
  ) {
    return notFound();
  }
  const headers = await playerHeaders();
  if (!headers) return json({ code: "PLAYER_SESSION_REQUIRED" }, 401);
  return proxy(path, {
    method: "GET",
    cache: "no-store",
    headers,
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (
    !startPath.test(path) &&
    !submitPath.test(path) &&
    !hintPath.test(path) &&
    path !== "share-results" &&
    path !== "consents" &&
    path !== "analytics/events" &&
    path !== "devices/push-token"
  ) {
    return notFound();
  }
  return forwardCommand(request, path, "POST");
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (!progressPath.test(path)) return notFound();
  return forwardCommand(request, path, "PUT");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (path !== "me/leaderboard-settings" && path !== "me/notification-preferences") {
    return notFound();
  }
  return forwardCommand(request, path, "PATCH");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const rejected = rejectCrossSiteMutation(request);
  if (rejected) return rejected;
  const path = (await context.params).path.join("/");
  if (path !== "me") return notFound();
  return forwardCommand(request, path, "DELETE");
}

async function forwardCommand(
  request: NextRequest,
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
) {
  const player = await playerHeaders();
  if (!player) return json({ code: "PLAYER_SESSION_REQUIRED" }, 401);
  const body =
    method === "DELETE" ||
    method === "PUT" ||
    method === "PATCH" ||
    hintPath.test(path) ||
    path === "share-results" ||
    path === "consents" ||
    path === "analytics/events" ||
    path === "devices/push-token"
      ? await request.text()
      : undefined;
  return proxy(path, {
    method,
    body: body || undefined,
    cache: "no-store",
    headers: {
      ...player,
      ...(body ? { "Content-Type": "application/json" } : {}),
      "idempotency-key": crypto.randomUUID(),
      "x-client-platform": "web",
    },
  });
}

async function playerHeaders(): Promise<Record<string, string> | null> {
  const accessToken = await getAccountAccessToken();
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  const token = (await cookies()).get(cookieName)?.value;
  return token ? { "x-guest-token": token } : null;
}

async function proxy(path: string, init: RequestInit) {
  try {
    const response = await fetch(`${apiUrl()}/${path}`, init);
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: {
        "Cache-Control":
          response.headers.get("Cache-Control") ??
          (init.method === "GET"
            ? "public, max-age=30, stale-while-revalidate=60"
            : "private, no-store"),
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
        ...(response.headers.get("Content-Disposition")
          ? { "Content-Disposition": response.headers.get("Content-Disposition")! }
          : {}),
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
