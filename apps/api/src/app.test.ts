import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GuestTokenError,
  NotificationSettingsError,
  PrivacyError,
  QuizAttemptError,
} from "@ludico/database";
import { constructCrossword } from "@ludico/domain";
import { buildApp } from "./app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("health", () => {
  it("reports a ready process", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-correlation-id"]).toBeTypeOf("string");
  });

  it("separates process health from dependency readiness", async () => {
    const ready = buildApp({ isReady: async () => true });
    const unavailable = buildApp({
      isReady: async () => {
        throw new Error("database unavailable");
      },
    });
    apps.push(ready, unavailable);

    await expect(ready.inject({ method: "GET", url: "/ready" })).resolves.toMatchObject({
      statusCode: 200,
    });
    const response = await unavailable.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
  });

  it("keeps a valid correlation id and rejects untrusted browser origins", async () => {
    const app = buildApp({ publicWebUrl: "https://ludico.example" });
    apps.push(app);
    const correlated = await app.inject({
      headers: { "x-correlation-id": "support-case-123" },
      method: "GET",
      url: "/health",
    });
    expect(correlated.headers["x-correlation-id"]).toBe("support-case-123");
    const rejected = await app.inject({
      headers: { origin: "https://evil.example" },
      method: "GET",
      url: "/v1/editions/today",
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({ code: "ORIGIN_NOT_ALLOWED" });
  });

  it("exposes only bounded, token-protected HTTP response counters", async () => {
    const app = buildApp({ metricsToken: "metrics-secret" });
    apps.push(app);
    await app.inject({ method: "GET", url: "/health" });

    const hidden = await app.inject({ method: "GET", url: "/metrics" });
    expect(hidden.statusCode).toBe(404);

    const metrics = await app.inject({
      headers: { authorization: "Bearer metrics-secret" },
      method: "GET",
      url: "/metrics",
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers["cache-control"]).toBe("private, no-store");
    expect(metrics.body).toContain(
      'ludico_http_responses_total{method="GET",route="/health",status="200"} 1',
    );
    expect(metrics.body).not.toContain("correlation");
  });
});

describe("today edition", () => {
  it("returns only the public game payload", async () => {
    const app = buildApp({
      getTodayEdition: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        localDate: "2026-07-28",
        opensAt: "2026-07-27T22:00:00.000Z",
        closesAt: "2026-07-28T22:00:00.000Z",
        games: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            type: "quiz",
            status: "active",
            contentVersion: 1,
            payload: { title: "Quiz diario" },
          },
        ],
      }),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/editions/today" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("public");
    expect(response.body).not.toContain("solution");
    expect(response.json().games).toHaveLength(1);
  });

  it("does not invent an edition when none is published", async () => {
    const app = buildApp({ getTodayEdition: async () => null });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/editions/today" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "EDITION_NOT_FOUND" });
  });

  it("serves only an explicitly available date from the limited archive", async () => {
    const getEditionByDate = vi.fn().mockResolvedValue({
      closesAt: "2026-07-28T22:00:00.000Z",
      games: [],
      id: "11111111-1111-4111-8111-111111111111",
      localDate: "2026-07-28",
      opensAt: "2026-07-27T22:00:00.000Z",
    });
    const app = buildApp({ getEditionByDate });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/v1/editions/2026-07-28" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("public");
    expect(getEditionByDate).toHaveBeenCalledWith("2026-07-28", expect.any(Date));
    const invalid = await app.inject({ method: "GET", url: "/v1/editions/not-a-date" });
    expect(invalid.statusCode).toBe(400);
  });
});

describe("guest sessions", () => {
  const credential = {
    guestSessionId: "44444444-4444-4444-8444-444444444444",
    token: "a".repeat(43),
    expiresAt: "2026-08-28T08:00:00.000Z",
  };

  it("creates a credential once with no-store headers", async () => {
    const app = buildApp({ createGuestSession: async () => credential });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/guest-sessions",
      payload: { origin: "web" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual(credential);
  });

  it("caps repeated guest-session creation and returns retry guidance", async () => {
    const app = buildApp({ createGuestSession: async () => credential });
    apps.push(app);
    for (let request = 0; request < 10; request += 1) {
      expect(
        (
          await app.inject({
            method: "POST",
            payload: { origin: "web" },
            url: "/v1/guest-sessions",
          })
        ).statusCode,
      ).toBe(201);
    }
    const limited = await app.inject({
      method: "POST",
      payload: { origin: "web" },
      url: "/v1/guest-sessions",
    });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("rotates an existing credential and rejects an invalid one uniformly", async () => {
    const valid = buildApp({ rotateGuestSession: async () => credential });
    apps.push(valid);
    const rotated = await valid.inject({
      method: "POST",
      url: "/v1/guest-sessions",
      headers: { "x-guest-token": "b".repeat(43) },
      payload: { origin: "web" },
    });
    expect(rotated.statusCode).toBe(200);

    const invalid = buildApp({
      rotateGuestSession: async () => {
        throw new GuestTokenError();
      },
    });
    apps.push(invalid);
    const rejected = await invalid.inject({
      method: "POST",
      url: "/v1/guest-sessions",
      headers: { "x-guest-token": "c".repeat(43) },
      payload: { origin: "web" },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toEqual({ code: "INVALID_GUEST_TOKEN" });
  });

  it("revokes without revealing whether the token existed", async () => {
    const app = buildApp({ revokeGuestSession: async () => false });
    apps.push(app);

    const response = await app.inject({
      method: "DELETE",
      url: "/v1/guest-sessions/current",
      headers: { "x-guest-token": "d".repeat(43) },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });
});

describe("game solution", () => {
  const gameId = "22222222-2222-4222-8222-222222222222";

  it("returns 423 without a cacheable payload before close", async () => {
    const app = buildApp({ getGameSolution: async () => ({ status: "locked" }) });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: `/v1/games/${gameId}/solution` });

    expect(response.statusCode).toBe(423);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ code: "SOLUTION_LOCKED" });
  });

  it("returns the public projection after close", async () => {
    const app = buildApp({
      getGameSolution: async () => ({
        status: "available",
        solution: {
          gameId,
          game: {
            contentVersion: 1,
            id: gameId,
            payload: { kind: "quiz", questions: [], title: "Quiz cerrado" },
            status: "active",
            type: "quiz",
          },
          publishedAt: "2026-07-28T22:00:00.000Z",
          payload: { explanation: "Respuesta verificada" },
        },
      }),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: `/v1/games/${gameId}/solution` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("public");
    expect(response.json().payload).toEqual({ explanation: "Respuesta verificada" });
  });
});

describe("attempt review", () => {
  const attemptId = "66666666-6666-4666-8666-666666666666";
  const gameId = "22222222-2222-4222-8222-222222222222";
  const headers = { "x-guest-token": "a".repeat(43) };

  it("keeps personal comparison private and locked before close", async () => {
    const app = buildApp({ getAttemptReview: async () => ({ status: "locked" }) });
    apps.push(app);

    const response = await app.inject({
      headers,
      method: "GET",
      url: `/v1/attempts/${attemptId}/review`,
    });

    expect(response.statusCode).toBe(423);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ code: "SOLUTION_LOCKED" });
  });

  it("returns the owner's score and answers after close", async () => {
    const review = {
      attemptId,
      progress: {
        answers: [
          {
            elapsedMs: 1200,
            questionId: "44444444-4444-4444-8444-444444444444",
            selectedOptionId: "55555555-5555-4555-8555-555555555555",
          },
        ],
        kind: "quiz-progress" as const,
      },
      score: { competitive: true, points: 125, scoreVersion: "quiz-v1" },
      solution: {
        gameId,
        game: {
          contentVersion: 1,
          id: gameId,
          payload: { kind: "quiz", questions: [], title: "Quiz cerrado" },
          status: "active" as const,
          type: "quiz" as const,
        },
        payload: { kind: "quiz-solution", questions: [] },
        publishedAt: "2026-07-29T22:00:00.000Z",
      },
      submittedAt: "2026-07-29T21:00:00.000Z",
    };
    const app = buildApp({
      getAttemptReview: async () => ({ review, status: "available" }),
    });
    apps.push(app);

    const response = await app.inject({
      headers,
      method: "GET",
      url: `/v1/attempts/${attemptId}/review`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual(review);
  });
});

describe("guest account migration", () => {
  const userId = "77777777-7777-4777-8777-777777777777";
  const headers = {
    authorization: "Bearer verified-access-token",
    "idempotency-key": "migration-request-1",
    "x-guest-token": "a".repeat(43),
  };

  it("uses only the identity returned by the configured verifier", async () => {
    const migrateGuest = vi.fn().mockResolvedValue({ migratedAttempts: 2, userId });
    const app = buildApp({
      migrateGuest,
      verifyUserAccessToken: async () => ({
        email: "persona@example.com",
        provider: "supabase",
        subject: "auth-user-1",
      }),
    });
    apps.push(app);

    const response = await app.inject({
      headers,
      method: "POST",
      url: "/v1/auth/migrate-guest",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ migratedAttempts: 2, userId });
    expect(migrateGuest).toHaveBeenCalledWith(
      headers["x-guest-token"],
      {
        email: "persona@example.com",
        provider: "supabase",
        subject: "auth-user-1",
      },
      expect.any(Date),
    );
  });

  it("returns the same generic error for an invalid access token", async () => {
    const app = buildApp({
      migrateGuest: vi.fn(),
      verifyUserAccessToken: async () => null,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { ...headers, authorization: "Bearer invalid-token" },
      method: "POST",
      url: "/v1/auth/migrate-guest",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "INVALID_ACCESS_TOKEN" });
  });
});

describe("leaderboards and streaks", () => {
  const userId = "77777777-7777-4777-8777-777777777777";
  const authorization = "Bearer ranking-token";
  const userHeaders = { authorization, "idempotency-key": "ranking-request-1" };

  it("returns an own percentile and updates an opted-in alias for the verified user", async () => {
    const getLeaderboard = vi.fn().mockResolvedValue({
      entries: [{ alias: "Ana", durationMs: 20_000, points: 900, rank: 1 }],
      key: "2026-07-29",
      own: { durationMs: 30_000, percentile: 67, points: 850, rank: 2, total: 3 },
      scope: "daily",
    });
    const updateLeaderboardSettings = vi
      .fn()
      .mockResolvedValue({ alias: "Persona", leaderboardOptIn: true });
    const app = buildApp({
      getLeaderboard,
      getShareResultData: async () => ({
        competitive: true,
        gameId: "22222222-2222-4222-8222-222222222222",
        gameType: "quiz",
        points: 850,
      }),
      getStreak: async () => ({ best: 4, current: 2, lastCompletedDate: "2026-07-29" }),
      publicWebUrl: "https://ludico.example",
      resolveUserAccessToken: async () => userId,
      updateLeaderboardSettings,
    });
    apps.push(app);

    const ranking = await app.inject({
      headers: { authorization },
      method: "GET",
      url: "/v1/leaderboards/daily/2026-07-29",
    });
    expect(ranking.statusCode).toBe(200);
    expect(ranking.headers["cache-control"]).toBe("private, no-store");
    expect(ranking.json()).toMatchObject({ own: { percentile: 67, rank: 2 } });
    expect(getLeaderboard).toHaveBeenCalledWith(
      "daily",
      "2026-07-29",
      { kind: "user", userId },
      expect.any(Date),
    );

    const streak = await app.inject({
      headers: { authorization },
      method: "GET",
      url: "/v1/me/streaks",
    });
    expect(streak.json()).toEqual({ best: 4, current: 2, lastCompletedDate: "2026-07-29" });

    const settings = await app.inject({
      headers: userHeaders,
      method: "PATCH",
      payload: { alias: "Persona", leaderboardOptIn: true },
      url: "/v1/me/leaderboard-settings",
    });
    expect(settings.statusCode).toBe(200);
    expect(updateLeaderboardSettings).toHaveBeenCalledWith(
      userId,
      { alias: "Persona", leaderboardOptIn: true },
      expect.any(Date),
    );

    const shared = await app.inject({
      headers: userHeaders,
      method: "POST",
      payload: { attemptId: "66666666-6666-4666-8666-666666666666" },
      url: "/v1/share-results",
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.json()).toEqual({
      text: "Lúdico · Quiz diario\n850 puntos · Clasificación",
      url: "https://ludico.example/resultados/22222222-2222-4222-8222-222222222222",
    });
    expect(shared.body).not.toMatch(/correctOptionId|answer|solution/i);
  });

  it("does not expose account-only streaks to a guest", async () => {
    const app = buildApp({ getStreak: vi.fn() });
    apps.push(app);
    const response = await app.inject({
      headers: { "x-guest-token": "g".repeat(43) },
      method: "GET",
      url: "/v1/me/streaks",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "ACCOUNT_REQUIRED" });
  });
});

describe("consent and analytics", () => {
  const headers = {
    "idempotency-key": "privacy-request-1",
    "x-client-platform": "android",
    "x-guest-token": "p".repeat(43),
  } as const;
  const consent = {
    ads: false,
    analytics: true,
    policyVersion: "2026-07-01",
    recordedAt: "2026-07-29T12:00:00.000Z",
  };

  it("reads and updates independent choices, then accepts an allowlisted event", async () => {
    const updateConsent = vi.fn().mockResolvedValue(consent);
    const ingestAnalytics = vi.fn().mockResolvedValue({ accepted: 1 });
    const app = buildApp({
      getConsent: async () => consent,
      ingestAnalytics,
      updateConsent,
    });
    apps.push(app);

    const current = await app.inject({
      headers,
      method: "GET",
      url: "/v1/consents/current",
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers["cache-control"]).toBe("private, no-store");

    const updated = await app.inject({
      headers,
      method: "POST",
      payload: { ads: false, analytics: true, policyVersion: "2026-07-01" },
      url: "/v1/consents",
    });
    expect(updated.statusCode).toBe(200);
    expect(updateConsent).toHaveBeenCalledWith(
      { kind: "guest", token: "p".repeat(43) },
      { ads: false, analytics: true, policyVersion: "2026-07-01" },
      "android",
      expect.any(Date),
    );

    const event = {
      eventId: "55555555-5555-4555-8555-555555555555",
      eventName: "AppOpened",
      occurredAt: "2026-07-29T12:00:00.000Z",
      properties: { platform: "android" },
      schemaVersion: 1,
    };
    const ingested = await app.inject({
      headers,
      method: "POST",
      payload: { events: [event] },
      url: "/v1/analytics/events",
    });
    expect(ingested.json()).toEqual({ accepted: 1 });
    expect(ingestAnalytics).toHaveBeenCalledWith(
      { kind: "guest", token: "p".repeat(43) },
      [event],
      expect.any(Date),
    );
  });

  it("maps stale policies and unsafe telemetry without leaking details", async () => {
    const stale = buildApp({
      updateConsent: async () => {
        throw new PrivacyError("CONSENT_POLICY_OUTDATED");
      },
    });
    apps.push(stale);
    const staleResponse = await stale.inject({
      headers,
      method: "POST",
      payload: { ads: false, analytics: false, policyVersion: "old" },
      url: "/v1/consents",
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toEqual({ code: "CONSENT_POLICY_OUTDATED" });

    const unsafe = buildApp({
      ingestAnalytics: async () => {
        throw new PrivacyError("INVALID_ANALYTICS_EVENT");
      },
    });
    apps.push(unsafe);
    const unsafeResponse = await unsafe.inject({
      headers,
      method: "POST",
      payload: {
        events: [
          {
            eventId: "55555555-5555-4555-8555-555555555555",
            eventName: "AppOpened",
            occurredAt: "2026-07-29T12:00:00.000Z",
            properties: { answer: "secret" },
            schemaVersion: 1,
          },
        ],
      },
      url: "/v1/analytics/events",
    });
    expect(unsafeResponse.statusCode).toBe(422);
    expect(unsafeResponse.json()).toEqual({ code: "INVALID_ANALYTICS_EVENT" });
  });
});

describe("previous results", () => {
  it("returns yesterday only to an account", async () => {
    const previous = [
      {
        attemptId: "33333333-3333-4333-8333-333333333333",
        competitive: true,
        gameId: "22222222-2222-4222-8222-222222222222",
        gameType: "quiz" as const,
        localDate: "2026-07-28",
        points: 800,
        rank: 2,
        total: 20,
      },
    ];
    const getPreviousResults = vi.fn().mockResolvedValue(previous);
    const app = buildApp({
      getPreviousResults,
      resolveUserAccessToken: async () => "77777777-7777-4777-8777-777777777777",
    });
    apps.push(app);

    const response = await app.inject({
      headers: { authorization: "Bearer account-token" },
      method: "GET",
      url: "/v1/me/previous-results",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(previous);
    expect(getPreviousResults).toHaveBeenCalledWith(
      "77777777-7777-4777-8777-777777777777",
      expect.any(Date),
    );
    const guest = await app.inject({
      headers: { "x-guest-token": "a".repeat(43) },
      method: "GET",
      url: "/v1/me/previous-results",
    });
    expect(guest.statusCode).toBe(401);
  });
});

describe("account data rights", () => {
  const authorization = "Bearer account-token";
  const userId = "77777777-7777-4777-8777-777777777777";
  const exported = {
    analyticsEvents: [],
    attempts: [
      {
        competitive: true,
        gameType: "quiz" as const,
        id: "33333333-3333-4333-8333-333333333333",
        localDate: "2026-07-28",
        mode: "competitive" as const,
        points: 800,
        startedAt: "2026-07-28T10:00:00.000Z",
        status: "finalized",
        submittedAt: "2026-07-28T10:02:00.000Z",
      },
    ],
    consents: [],
    crosswordCells: [],
    generatedAt: "2026-07-29T12:00:00.000Z",
    notificationPreferences: null,
    profile: {
      alias: null,
      createdAt: "2026-07-20T12:00:00.000Z",
      email: "persona@example.com",
      leaderboardOptIn: false,
    },
    quizAnswers: [],
    wordGuesses: [],
    wordSearchFinds: [],
  };

  it("exports private portable JSON and deletes only after explicit confirmation", async () => {
    const getAccountData = vi.fn().mockResolvedValue(exported);
    const deleteAccount = vi.fn().mockResolvedValue(true);
    const app = buildApp({
      deleteAccount,
      getAccountData,
      now: () => new Date("2026-07-29T12:00:00Z"),
      resolveUserAccessToken: async () => userId,
    });
    apps.push(app);

    const data = await app.inject({
      headers: { authorization },
      method: "GET",
      url: "/v1/me/data-export",
    });
    expect(data.statusCode).toBe(200);
    expect(data.headers["cache-control"]).toBe("private, no-store");
    expect(data.headers["content-disposition"]).toContain("ludico-datos.json");
    expect(data.json()).toEqual(exported);

    const invalid = await app.inject({
      headers: { authorization, "idempotency-key": "delete-account-1" },
      method: "DELETE",
      payload: { confirmation: "no" },
      url: "/v1/me",
    });
    expect(invalid.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();

    const deleted = await app.inject({
      headers: { authorization, "idempotency-key": "delete-account-2" },
      method: "DELETE",
      payload: { confirmation: "ELIMINAR" },
      url: "/v1/me",
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(deleteAccount).toHaveBeenCalledWith(userId, expect.any(String), expect.any(Date));
  });

  it("rejects guests for both rights routes", async () => {
    const app = buildApp({ deleteAccount: vi.fn(), getAccountData: vi.fn() });
    apps.push(app);
    const headers = { "x-guest-token": "a".repeat(43) };
    expect(
      (await app.inject({ headers, method: "GET", url: "/v1/me/data-export" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          headers: { ...headers, "idempotency-key": "delete-guest-1" },
          method: "DELETE",
          payload: { confirmation: "ELIMINAR" },
          url: "/v1/me",
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("notification preferences", () => {
  const userId = "77777777-7777-4777-8777-777777777777";
  const headers = { authorization: "Bearer notifications", "idempotency-key": "notify-1" };
  const preferences = {
    editionAvailable: true,
    enabled: true,
    previousSolution: true,
    quietEnd: "08:00",
    quietStart: "22:00",
    timeZone: "Europe/Madrid",
  };

  it("keeps account settings private and registers an opaque Expo endpoint", async () => {
    const updateNotificationPreferences = vi.fn().mockResolvedValue(preferences);
    const registerPushEndpoint = vi
      .fn()
      .mockResolvedValue({ endpointId: "88888888-8888-4888-8888-888888888888" });
    const app = buildApp({
      getNotificationPreferences: async () => preferences,
      registerPushEndpoint,
      resolveUserAccessToken: async () => userId,
      updateNotificationPreferences,
    });
    apps.push(app);

    const current = await app.inject({
      headers,
      method: "GET",
      url: "/v1/me/notification-preferences",
    });
    expect(current.statusCode).toBe(200);
    expect(current.headers["cache-control"]).toBe("private, no-store");

    const updated = await app.inject({
      headers,
      method: "PATCH",
      payload: preferences,
      url: "/v1/me/notification-preferences",
    });
    expect(updated.statusCode).toBe(200);
    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      userId,
      preferences,
      expect.any(Date),
    );

    const token = `ExpoPushToken[${"a".repeat(32)}]`;
    const endpoint = await app.inject({
      headers,
      method: "POST",
      payload: { platform: "android", token },
      url: "/v1/devices/push-token",
    });
    expect(endpoint.statusCode).toBe(200);
    expect(registerPushEndpoint).toHaveBeenCalledWith(userId, token, "android", expect.any(Date));
  });

  it("rejects guests and maps invalid preferences safely", async () => {
    const guest = buildApp({ getNotificationPreferences: vi.fn() });
    apps.push(guest);
    const guestResponse = await guest.inject({
      headers: { "x-guest-token": "n".repeat(43) },
      method: "GET",
      url: "/v1/me/notification-preferences",
    });
    expect(guestResponse.statusCode).toBe(401);
    expect(guestResponse.json()).toEqual({ code: "ACCOUNT_REQUIRED" });

    const invalid = buildApp({
      resolveUserAccessToken: async () => userId,
      updateNotificationPreferences: async () => {
        throw new NotificationSettingsError("INVALID_NOTIFICATION_PREFERENCES");
      },
    });
    apps.push(invalid);
    const response = await invalid.inject({
      headers,
      method: "PATCH",
      payload: preferences,
      url: "/v1/me/notification-preferences",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: "INVALID_NOTIFICATION_PREFERENCES" });
  });
});

describe("quiz attempt", () => {
  const gameId = "22222222-2222-4222-8222-222222222222";
  const attemptId = "66666666-6666-4666-8666-666666666666";
  const guestHeaders = {
    "idempotency-key": "quiz-request-1",
    "x-guest-token": "g".repeat(43),
  };

  it("serves public content and completes the command flow without corrections", async () => {
    const state = { answers: [], attemptId, status: "in_progress" as const, version: 1 };
    const app = buildApp({
      getPublishedGame: async () => ({
        contentVersion: 1,
        id: gameId,
        payload: { kind: "quiz", title: "Quiz", questions: [] },
        status: "active",
        type: "quiz",
      }),
      startQuizAttempt: async () => state,
      saveQuizProgress: async () => ({ savedEvents: 1, status: "saved", version: 2 }),
      submitQuizAttempt: async () => ({
        attemptId,
        competitive: true,
        provisional: { completed: true, score: 500 },
        solutionAvailableAt: "2026-07-29T22:00:00.000Z",
        status: "accepted",
      }),
    });
    apps.push(app);

    const game = await app.inject({ method: "GET", url: `/v1/games/${gameId}` });
    expect(game.statusCode).toBe(200);
    expect(game.body).not.toContain("correctOptionId");

    const started = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: guestHeaders,
    });
    expect(started.json()).toEqual(state);

    const progress = await app.inject({
      method: "PUT",
      url: `/v1/attempts/${attemptId}/progress`,
      headers: guestHeaders,
      payload: {
        version: 1,
        events: [
          {
            clientEventId: "77777777-7777-4777-8777-777777777777",
            questionId: "88888888-8888-4888-8888-888888888888",
            selectedOptionId: "99999999-9999-4999-8999-999999999999",
            elapsedMs: 1_000,
          },
        ],
      },
    });
    expect(progress.json()).toEqual({ savedEvents: 1, status: "saved", version: 2 });

    const submitted = await app.inject({
      method: "POST",
      url: `/v1/attempts/${attemptId}/submit`,
      headers: guestHeaders,
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({ provisional: { score: 500 }, status: "accepted" });
    expect(submitted.body).not.toContain("correct");
  });

  it("maps guest authorization failures without leaking details", async () => {
    const app = buildApp({
      startQuizAttempt: async () => {
        throw new QuizAttemptError("UNAUTHORIZED", "internal detail");
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: guestHeaders,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "UNAUTHORIZED" });
  });

  it("resolves a bearer token to the registered user and rejects ambiguous credentials", async () => {
    const userId = "77777777-7777-4777-8777-777777777777";
    const state = { answers: [], attemptId, status: "in_progress" as const, version: 1 };
    const startQuizAttempt = vi.fn().mockResolvedValue(state);
    const app = buildApp({
      resolveUserAccessToken: async (token) => (token === "valid-token" ? userId : null),
      startQuizAttempt,
    });
    apps.push(app);

    const authenticated = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "user-request-1",
      },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(startQuizAttempt).toHaveBeenCalledWith(
      gameId,
      { kind: "user", userId },
      expect.any(Date),
    );

    const invalid = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: {
        authorization: "Bearer invalid-token",
        "idempotency-key": "user-request-2",
      },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ code: "INVALID_ACCESS_TOKEN" });

    const ambiguous = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: {
        authorization: "Bearer valid-token",
        "idempotency-key": "user-request-3",
        "x-guest-token": "g".repeat(43),
      },
    });
    expect(ambiguous.statusCode).toBe(401);
    expect(ambiguous.json()).toEqual({ code: "UNAUTHORIZED" });
    expect(startQuizAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("crossword attempt", () => {
  const gameId = "22222222-2222-4222-8222-222222222223";
  const attemptId = "66666666-6666-4666-8666-666666666667";
  const guestHeaders = {
    "idempotency-key": "crossword-request-1",
    "x-guest-token": "c".repeat(43),
  };

  it("accepts cell progress and returns only a provisional total", async () => {
    const state = {
      attemptId,
      cells: [],
      hintsUsed: 0,
      status: "in_progress" as const,
      version: 1,
    };
    const app = buildApp({
      startAttempt: async () => state,
      saveProgress: async () => ({ savedEvents: 1, status: "saved", version: 2 }),
      revealCrosswordCell: async (_attemptId, _token, cellId) => ({
        attemptId,
        cellId,
        competitive: false,
        hintsUsed: 1,
        value: "Ñ",
        version: 3,
      }),
      submitAttempt: async () => ({
        attemptId,
        competitive: true,
        provisional: { completed: true, score: 1_350 },
        solutionAvailableAt: "2026-07-29T22:00:00.000Z",
        status: "accepted",
      }),
    });
    apps.push(app);

    const started = await app.inject({
      method: "POST",
      url: `/v1/games/${gameId}/attempts`,
      headers: guestHeaders,
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toEqual(state);

    const progress = await app.inject({
      method: "PUT",
      url: `/v1/attempts/${attemptId}/progress`,
      headers: guestHeaders,
      payload: {
        events: [
          {
            cellId: "a0000000-0000-4000-8000-000000000000",
            clientEventId: "b0000000-0000-4000-8000-000000000000",
            elapsedMs: 100,
            value: "Ñ",
          },
        ],
        version: 1,
      },
    });
    expect(progress.json()).toEqual({ savedEvents: 1, status: "saved", version: 2 });

    const hint = await app.inject({
      method: "POST",
      url: `/v1/attempts/${attemptId}/hints`,
      headers: guestHeaders,
      payload: {
        cellId: "a0000000-0000-4000-8000-000000000000",
        clientEventId: "b0000000-0000-4000-8000-000000000001",
      },
    });
    expect(hint.statusCode).toBe(200);
    expect(hint.headers["cache-control"]).toBe("private, no-store");
    expect(hint.json()).toMatchObject({ competitive: false, hintsUsed: 1, value: "Ñ" });

    const submitted = await app.inject({
      method: "POST",
      url: `/v1/attempts/${attemptId}/submit`,
      headers: guestHeaders,
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({ provisional: { score: 1_350 } });
    expect(submitted.body).not.toContain("answer");
    expect(submitted.body).not.toContain("correct");
  });
});

describe("human content administration", () => {
  const now = new Date("2026-08-01T10:10:00.000Z");
  const candidateId = "88888888-8888-4888-8888-888888888888";
  const content = {
    contentType: "quiz" as const,
    findings: [],
    id: candidateId,
    privatePayload: { kind: "quiz-solution" },
    publicPayload: { kind: "quiz", questions: [], title: "Preview" },
    sources: [],
    status: "approved" as const,
    targetDate: "2026-08-03",
  };
  const resolveAdminAccessToken = async (token: string) => {
    const role =
      token === "analyst"
        ? "analyst"
        : token === "superadmin"
          ? "superadmin"
          : token === "support"
            ? "support"
            : token === "moderator"
              ? "moderator"
              : "editor";
    return {
      reauthenticatedAt:
        token === "stale" ? "2026-08-01T09:00:00.000Z" : "2026-08-01T10:00:00.000Z",
      role: role as "analyst" | "editor" | "moderator" | "superadmin" | "support",
      userId: `user-${token}`,
    };
  };

  it("renders a private no-store SVG preview without solution letters", async () => {
    const candidate = constructCrossword(
      [
        word("sol", "SOL", "Astro diurno"),
        word("sal", "SAL", "Condimento"),
        word("luz", "LUZ", "Claridad"),
      ],
      { seed: "api-svg", title: "Vista segura", vocabularyVersion: "test-v1" },
    );
    const app = buildApp({
      getGeneratedContent: async () => ({
        ...content,
        contentType: "crossword",
        privatePayload: candidate.privatePayload,
        publicPayload: candidate.publicPayload,
        sources: candidate.sources,
      }),
      resolveAdminAccessToken,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { authorization: "Bearer analyst" },
      method: "GET",
      url: `/v1/admin/content/${candidateId}/preview.svg`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.body).toContain("<svg");
    expect(response.body).not.toMatch(/SOL|SAL|LUZ|answer/i);
  });

  it("applies the read matrix and requires recent reauthentication for commands", async () => {
    const planContentJobs = vi.fn().mockResolvedValue([
      {
        budgetMicros: 1_000,
        contentType: "quiz",
        id: "99999999-9999-4999-8999-999999999999",
        promptVersion: "v1",
        provider: "fake",
        targetDate: "2026-08-03",
      },
    ]);
    const app = buildApp({
      listGeneratedContent: async () => [content],
      now: () => now,
      planContentJobs,
      resolveAdminAccessToken,
    });
    apps.push(app);

    const read = await app.inject({
      headers: { authorization: "Bearer analyst" },
      method: "GET",
      url: "/v1/admin/content?status=approved",
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("private, no-store");
    expect(read.json()).toEqual([content]);

    const forbiddenRead = await app.inject({
      headers: { authorization: "Bearer support" },
      method: "GET",
      url: "/v1/admin/content",
    });
    expect(forbiddenRead.statusCode).toBe(403);
    expect(forbiddenRead.json()).toEqual({ code: "FORBIDDEN" });

    const stale = await app.inject({
      headers: { authorization: "Bearer stale", "idempotency-key": "content-plan-1" },
      method: "POST",
      payload: { budgetMicros: 1_000, days: 1, startDate: "2026-08-03" },
      url: "/v1/admin/content/plan",
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toEqual({ code: "ADMIN_REAUTH_REQUIRED" });

    const planned = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "content-plan-2" },
      method: "POST",
      payload: { budgetMicros: 1_000, days: 1, startDate: "2026-08-03" },
      url: "/v1/admin/content/plan",
    });
    expect(planned.statusCode).toBe(200);
    expect(planContentJobs).toHaveBeenCalledWith("2026-08-03", 1, 1_000);
  });

  it("records the verified actor and explicit reason on review", async () => {
    const reviewGeneratedContent = vi.fn().mockResolvedValue({ changed: true, status: "rejected" });
    const regenerateGeneratedContent = vi.fn().mockResolvedValue({
      changed: true,
      jobId: "99999999-9999-4999-8999-999999999999",
      status: "queued",
    });
    const revised = { ...content, publicPayload: { ...content.publicPayload, title: "Revisado" } };
    const reviseGeneratedContent = vi.fn().mockResolvedValue(revised);
    const app = buildApp({
      now: () => now,
      regenerateGeneratedContent,
      resolveAdminAccessToken,
      reviseGeneratedContent,
      reviewGeneratedContent,
    });
    apps.push(app);
    const response = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "content-review-1" },
      method: "POST",
      payload: { reason: "La fuente no confirma el enunciado" },
      url: `/v1/admin/content/${candidateId}/reject`,
    });
    expect(response.statusCode).toBe(200);
    expect(reviewGeneratedContent).toHaveBeenCalledWith(
      candidateId,
      "rejected",
      "user-editor",
      "La fuente no confirma el enunciado",
      "content-review-1",
      now,
    );
    const regenerated = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "content-regenerate-1" },
      method: "POST",
      payload: { reason: "Solicitar una alternativa editorial segura" },
      url: `/v1/admin/content/${candidateId}/regenerate`,
    });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json()).toMatchObject({ status: "queued" });
    expect(regenerateGeneratedContent).toHaveBeenCalledWith(
      candidateId,
      "user-editor",
      "Solicitar una alternativa editorial segura",
      "content-regenerate-1",
      now,
    );

    const revisionPayload = {
      privatePayload: content.privatePayload,
      publicPayload: revised.publicPayload,
      reason: "Corrección editorial documentada",
      sources: content.sources,
    };
    const revision = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "content-revision-1" },
      method: "PATCH",
      payload: revisionPayload,
      url: `/v1/admin/content/${candidateId}`,
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.json()).toEqual(revised);
    expect(reviseGeneratedContent).toHaveBeenCalledWith(
      candidateId,
      {
        privatePayload: content.privatePayload,
        publicPayload: revised.publicPayload,
        sources: content.sources,
      },
      "user-editor",
      "Corrección editorial documentada",
      "content-revision-1",
      now,
    );
  });

  it("lets a recently reauthenticated moderator manage blocked terms", async () => {
    const term = {
      active: true,
      id: "77777777-7777-4777-8777-777777777777",
      normalizedTerm: "oscuridad",
      reason: "Política editorial de la prueba",
    };
    const upsertBlockedTerm = vi.fn().mockResolvedValue(term);
    const deactivateBlockedTerm = vi
      .fn()
      .mockResolvedValue({ active: false, changed: true, id: term.id });
    const app = buildApp({
      deactivateBlockedTerm,
      listBlockedTerms: async () => [term],
      now: () => now,
      resolveAdminAccessToken,
      upsertBlockedTerm,
    });
    apps.push(app);

    const listed = await app.inject({
      headers: { authorization: "Bearer analyst" },
      method: "GET",
      url: "/v1/admin/blocked-terms",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([term]);

    const created = await app.inject({
      headers: { authorization: "Bearer moderator", "idempotency-key": "blocked-term-1" },
      method: "POST",
      payload: { reason: term.reason, term: "Oscuridad" },
      url: "/v1/admin/blocked-terms",
    });
    expect(created.statusCode).toBe(200);
    expect(upsertBlockedTerm).toHaveBeenCalledWith(
      "Oscuridad",
      term.reason,
      "user-moderator",
      "blocked-term-1",
      now,
    );

    const deactivated = await app.inject({
      headers: { authorization: "Bearer moderator", "idempotency-key": "blocked-term-2" },
      method: "POST",
      payload: { reason: "Ya no está bloqueado por política" },
      url: `/v1/admin/blocked-terms/${term.id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivateBlockedTerm).toHaveBeenCalledWith(
      term.id,
      "Ya no está bloqueado por política",
      "user-moderator",
      "blocked-term-2",
      now,
    );
  });

  it("lets an editor curate and deactivate sourced word-bank entries", async () => {
    const entry = {
      active: true,
      answer: "SOL",
      category: "AstronomÃ­a",
      clue: "Astro que ilumina el dÃ­a",
      difficulty: 1,
      id: "66666666-6666-4666-8666-666666666666",
      letterCount: 3,
      locale: "es-ES",
      qualityScore: 90,
      sourceCheckedAt: "2026-08-01T08:00:00.000Z",
      sourceUrl: "https://example.com/sol",
      validationStatus: "approved" as const,
      variants: [],
    };
    const upsertWordBankEntry = vi.fn().mockResolvedValue(entry);
    const deactivateWordBankEntry = vi
      .fn()
      .mockResolvedValue({ active: false, changed: true, id: entry.id });
    const app = buildApp({
      deactivateWordBankEntry,
      listCuratedWordBank: async () => [entry],
      now: () => now,
      resolveAdminAccessToken,
      upsertWordBankEntry,
    });
    apps.push(app);

    const listed = await app.inject({
      headers: { authorization: "Bearer analyst" },
      method: "GET",
      url: "/v1/admin/word-bank",
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([entry]);

    const reason = "Entrada y fuente revisadas editorialmente";
    const created = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "word-bank-create-1" },
      method: "POST",
      payload: {
        answer: entry.answer,
        category: entry.category,
        clue: entry.clue,
        difficulty: entry.difficulty,
        qualityScore: entry.qualityScore,
        reason,
        sourceCheckedAt: entry.sourceCheckedAt,
        sourceUrl: entry.sourceUrl,
        validationStatus: entry.validationStatus,
        variants: entry.variants,
      },
      url: "/v1/admin/word-bank",
    });
    expect(created.statusCode).toBe(200);
    expect(upsertWordBankEntry).toHaveBeenCalledWith(
      {
        answer: entry.answer,
        category: entry.category,
        clue: entry.clue,
        difficulty: entry.difficulty,
        qualityScore: entry.qualityScore,
        sourceCheckedAt: new Date(entry.sourceCheckedAt),
        sourceUrl: entry.sourceUrl,
        validationStatus: entry.validationStatus,
        variants: entry.variants,
      },
      "user-editor",
      reason,
      "word-bank-create-1",
      now,
    );

    const deactivated = await app.inject({
      headers: {
        authorization: "Bearer editor",
        "idempotency-key": "word-bank-deactivate-1",
      },
      method: "POST",
      payload: { reason: "La fuente dejÃ³ de estar vigente" },
      url: `/v1/admin/word-bank/${entry.id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivateWordBankEntry).toHaveBeenCalledWith(
      entry.id,
      "user-editor",
      "La fuente dejÃ³ de estar vigente",
      "word-bank-deactivate-1",
      now,
    );
  });

  it("exposes only aggregate product metrics to analytics readers", async () => {
    const dashboard = {
      daily: [{ activeSubjects: 4, completions: 2, localDate: "2026-08-01", starts: 3 }],
      definitions: {
        activeSubjects: "Sujetos seudÃ³nimos Ãºnicos con AppOpened en el periodo.",
        completionRate: "Intentos Ãºnicos completados / intentos Ãºnicos iniciados.",
      },
      freshness: "2026-08-01T10:00:00.000Z",
      generatedAt: now.toISOString(),
      owner: "Product/Data" as const,
      period: { days: 14, from: "2026-07-19", to: "2026-08-01" },
      totals: {
        activeSubjects: 4,
        completionRate: 66.7,
        completions: 2,
        quarantinedBatches: 1,
        registrations: 1,
        shares: 1,
        starts: 3,
      },
    };
    const getAnalyticsDashboard = vi.fn().mockResolvedValue(dashboard);
    const app = buildApp({ getAnalyticsDashboard, now: () => now, resolveAdminAccessToken });
    apps.push(app);

    const response = await app.inject({
      headers: { authorization: "Bearer analyst" },
      method: "GET",
      url: "/v1/admin/analytics/dashboard?days=14",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual(dashboard);
    expect(response.body).not.toMatch(/subjectId|attemptId/);
    expect(getAnalyticsDashboard).toHaveBeenCalledWith(14, now);

    const supportSummary = await app.inject({
      headers: { authorization: "Bearer support" },
      method: "GET",
      url: "/v1/admin/analytics/dashboard?days=14",
    });
    expect(supportSummary.statusCode).toBe(200);
  });

  it("lets a recently reauthenticated editor schedule an approved edition", async () => {
    const editionId = "55555555-5555-4555-8555-555555555555";
    const scheduleReserveEdition = vi.fn().mockResolvedValue({
      changed: true,
      status: "scheduled",
    });
    const app = buildApp({
      now: () => now,
      resolveAdminAccessToken,
      scheduleReserveEdition,
    });
    apps.push(app);
    const response = await app.inject({
      headers: { authorization: "Bearer editor", "idempotency-key": "schedule-human-1" },
      method: "POST",
      payload: { reason: "Reserva completa revisada por el editor" },
      url: `/v1/admin/editions/${editionId}/schedule`,
    });
    expect(response.statusCode).toBe(200);
    expect(scheduleReserveEdition).toHaveBeenCalledWith(
      editionId,
      "Reserva completa revisada por el editor",
      "schedule-human-1",
      { id: "user-editor", type: "admin" },
    );
  });

  it("lets a reauthenticated superadmin read and update publication settings", async () => {
    const settings = {
      closesAtLocalTime: "00:00",
      contentPlanLocalTime: "02:00",
      market: "ES" as const,
      opensAtLocalTime: "00:00",
      reserveDays: 14,
    };
    const getPublicationSettings = vi.fn().mockResolvedValue(settings);
    const updatePublicationSettings = vi.fn().mockResolvedValue({
      ...settings,
      contentPlanLocalTime: "01:15",
      reserveDays: 16,
    });
    const app = buildApp({
      getPublicationSettings,
      now: () => now,
      resolveAdminAccessToken,
      updatePublicationSettings,
    });
    apps.push(app);

    const read = await app.inject({
      headers: { authorization: "Bearer editor" },
      method: "GET",
      url: "/v1/admin/publication-settings",
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(settings);

    const update = await app.inject({
      headers: { authorization: "Bearer superadmin", "idempotency-key": "settings-human-1" },
      method: "PATCH",
      payload: {
        ...settings,
        contentPlanLocalTime: "01:15",
        reason: "Ajuste nocturno revisado por operaciones",
        reserveDays: 16,
      },
      url: "/v1/admin/publication-settings",
    });
    expect(update.statusCode).toBe(200);
    expect(updatePublicationSettings).toHaveBeenCalledWith(
      {
        closesAtLocalTime: "00:00",
        contentPlanLocalTime: "01:15",
        opensAtLocalTime: "00:00",
        reserveDays: 16,
      },
      "user-superadmin",
      "Ajuste nocturno revisado por operaciones",
      "settings-human-1",
      now,
    );
  });

  it("restricts the bounded audit feed to superadmin", async () => {
    const audit = [
      {
        action: "schedule",
        actorId: "editor-1",
        actorType: "admin",
        correlationId: "audit-1",
        id: "44444444-4444-4444-8444-444444444444",
        occurredAt: "2026-08-01T10:00:00.000Z",
        reason: "Reserva completa revisada",
        targetId: "edition-1",
        targetType: "DailyEdition",
      },
    ];
    const listAdminAudit = vi.fn().mockResolvedValue(audit);
    const app = buildApp({ listAdminAudit, resolveAdminAccessToken });
    apps.push(app);

    const forbidden = await app.inject({
      headers: { authorization: "Bearer editor" },
      method: "GET",
      url: "/v1/admin/audit",
    });
    expect(forbidden.statusCode).toBe(403);

    const response = await app.inject({
      headers: { authorization: "Bearer superadmin" },
      method: "GET",
      url: "/v1/admin/audit?limit=25",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual(audit);
    expect(listAdminAudit).toHaveBeenCalledWith(25);
  });
});

function word(id: string, answer: string, clue: string) {
  return { answer, clue, id, sourceUrl: `https://example.com/${id}` };
}

describe("emergency administration", () => {
  const gameId = "22222222-2222-4222-8222-222222222222";

  it("rejects a command without the emergency credential", async () => {
    const app = buildApp({ adminApiKey: "secret" });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/games/${gameId}/disable`,
      headers: { "idempotency-key": "request-1" },
      payload: { reason: "contenido defectuoso" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "UNAUTHORIZED" });
  });

  it("runs an authenticated idempotent command", async () => {
    const calls: string[] = [];
    const app = buildApp({
      adminApiKey: "secret",
      disableGame: async (_id, _reason, correlationId) => {
        calls.push(correlationId);
        return { changed: true, status: "disabled" };
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/games/${gameId}/disable`,
      headers: { authorization: "Bearer secret", "idempotency-key": "request-2" },
      payload: { reason: "contenido defectuoso" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ changed: true, status: "disabled" });
    expect(calls).toEqual(["request-2"]);
  });
});
