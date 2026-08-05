import {
  type AccountDataExport,
  accountDataExportSchema,
  accountDeletionResponseSchema,
  analyticsEventsSchema,
  analyticsIngestResultSchema,
  type AnalyticsEventInput,
  type AnalyticsIngestResult,
  attemptReviewSchema,
  type AttemptReview,
  consentStateSchema,
  type ConsentState,
  crosswordAttemptStateSchema,
  crosswordHintResultSchema,
  isCrosswordPublicPayload,
  type CrosswordAttemptState,
  type CrosswordHintResult,
  type CrosswordProgressEvent,
  type CrosswordSubmitResult,
  type GuessWordAttemptState,
  type GuessWordGuessEvent,
  type GuessWordGuessResult,
  guessWordAttemptStateSchema,
  guessWordGuessResultSchema,
  type GuestSessionCredential,
  guestSessionCredentialSchema,
  healthResponseSchema,
  type HealthResponse,
  type Leaderboard,
  leaderboardSchema,
  type NotificationPreferences,
  notificationPreferencesSchema,
  type PreviousResultSummary,
  previousResultSummariesSchema,
  type PublicEdition,
  type PublicGame,
  type PublicSolution,
  type QuizAttemptState,
  type QuizProgressEvent,
  type QuizSubmitResult,
  type WordSearchAttemptState,
  type WordSearchSelectionEvent,
  type WordSearchSelectionResult,
  wordSearchAttemptStateSchema,
  wordSearchSelectionEventSchema,
  wordSearchSelectionResultSchema,
  publicGameSchema,
  publicEditionSchema,
  publicSolutionSchema,
  quizAttemptStateSchema,
  quizSubmitResultSchema,
  type ShareResult,
  shareResultSchema,
  type StreakSummary,
  streakSummarySchema,
  type UserLeaderboardSettings,
  userLeaderboardSettingsSchema,
} from "@ludico/contracts";
import { createShareText, renderCrosswordSvg } from "@ludico/domain";
import {
  AdminCommandError,
  type AnalyticsDashboard,
  type AdminContentCalendar,
  type AdminAuditRecord,
  type BlockedTermRecord,
  type ContentJob,
  ContentPipelineError,
  CrosswordAttemptError,
  type CrosswordProgressResult,
  type ExternalIdentity,
  type GuestMigrationResult,
  GuestTokenError,
  type GeneratedContentRecord,
  LeaderboardSettingsError,
  NotificationSettingsError,
  PrivacyError,
  QuizAttemptError,
  type GuestOrigin,
  GuessWordAttemptError,
  WordSearchAttemptError,
  type QuizProgressResult,
  type ShareResultData,
  WordBankError,
  type WordBankRecord,
} from "@ludico/database";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { type AdminPrincipal, AuthProviderUnavailableError } from "./supabase-auth.js";

interface AppOptions {
  readonly adminApiKey?: string;
  readonly metricsToken?: string;
  readonly getAdminContentCalendar?: () => Promise<AdminContentCalendar>;
  readonly listAdminAudit?: (limit: number) => Promise<readonly AdminAuditRecord[]>;
  readonly getAnalyticsDashboard?: (days: number, now: Date) => Promise<AnalyticsDashboard>;
  readonly getGeneratedContent?: (contentId: string) => Promise<GeneratedContentRecord | null>;
  readonly getAccountData?: (userId: string, now: Date) => Promise<AccountDataExport | null>;
  readonly deleteAccount?: (userId: string, correlationId: string, now: Date) => Promise<boolean>;
  readonly disableGame?: (
    gameId: string,
    reason: string,
    correlationId: string,
  ) => Promise<{ changed: boolean; status: "disabled" }>;
  readonly createGuestSession?: (origin: GuestOrigin, now: Date) => Promise<GuestSessionCredential>;
  readonly getTodayEdition?: (now: Date) => Promise<PublicEdition | null>;
  readonly getEditionByDate?: (localDate: string, now: Date) => Promise<PublicEdition | null>;
  readonly getGameSolution?: (
    gameId: string,
    now: Date,
  ) => Promise<
    | { status: "available"; solution: PublicSolution }
    | { status: "locked" }
    | { status: "not_found" }
  >;
  readonly getAttemptReview?: (
    attemptId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<{ status: "available"; review: AttemptReview } | { status: "locked" | "not_found" }>;
  readonly getConsent?: (player: PlayerCredential, now: Date) => Promise<ConsentState>;
  readonly getPublishedGame?: (gameId: string, now: Date) => Promise<PublicGame | null>;
  readonly getLeaderboard?: (
    scope: "daily" | "game" | "weekly",
    key: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<Leaderboard>;
  readonly getLeaderboardSettings?: (userId: string) => Promise<UserLeaderboardSettings | null>;
  readonly getNotificationPreferences?: (userId: string) => Promise<NotificationPreferences | null>;
  readonly getStreak?: (userId: string, today: string) => Promise<StreakSummary>;
  readonly getPreviousResults?: (
    userId: string,
    now: Date,
  ) => Promise<readonly PreviousResultSummary[]>;
  readonly getShareResultData?: (
    attemptId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<ShareResultData | null>;
  readonly listGeneratedContent?: (
    status?: GeneratedContentRecord["status"],
  ) => Promise<readonly GeneratedContentRecord[]>;
  readonly listBlockedTerms?: () => Promise<readonly BlockedTermRecord[]>;
  readonly listCuratedWordBank?: (now: Date) => Promise<readonly WordBankRecord[]>;
  readonly upsertBlockedTerm?: (
    term: string,
    reason: string,
    actorId: string,
    correlationId: string,
    now: Date,
  ) => Promise<BlockedTermRecord>;
  readonly deactivateBlockedTerm?: (
    id: string,
    reason: string,
    actorId: string,
    correlationId: string,
    now: Date,
  ) => Promise<{ active: false; changed: boolean; id: string }>;
  readonly deactivateWordBankEntry?: (
    id: string,
    actorId: string,
    reason: string,
    correlationId: string,
    now: Date,
  ) => Promise<{ active: false; changed: boolean; id: string }>;
  readonly ingestAnalytics?: (
    player: PlayerCredential,
    events: readonly AnalyticsEventInput[],
    now: Date,
  ) => Promise<AnalyticsIngestResult>;
  readonly isReady?: () => Promise<boolean>;
  readonly migrateGuest?: (
    guestToken: string,
    identity: ExternalIdentity,
    now: Date,
  ) => Promise<GuestMigrationResult>;
  readonly now?: () => Date;
  readonly publicWebUrl?: string;
  readonly planContentJobs?: (
    startDate: string,
    days: number,
    budgetMicros: number,
  ) => Promise<readonly ContentJob[]>;
  readonly revokeGuestSession?: (token: string, now: Date) => Promise<boolean>;
  readonly revealCrosswordCell?: (
    attemptId: string,
    player: PlayerCredential,
    cellId: string,
    clientEventId: string,
    now: Date,
  ) => Promise<CrosswordHintResult>;
  readonly rotateGuestSession?: (token: string, now: Date) => Promise<GuestSessionCredential>;
  readonly registerPushEndpoint?: (
    userId: string,
    token: string,
    platform: "android" | "ios",
    now: Date,
  ) => Promise<{ endpointId: string }>;
  readonly saveProgress?: (
    attemptId: string,
    player: PlayerCredential,
    version: number,
    events: readonly (QuizProgressEvent | CrosswordProgressEvent)[],
    now: Date,
  ) => Promise<QuizProgressResult | CrosswordProgressResult>;
  readonly saveQuizProgress?: (
    attemptId: string,
    player: PlayerCredential,
    version: number,
    events: readonly QuizProgressEvent[],
    now: Date,
  ) => Promise<QuizProgressResult>;
  readonly scheduleReserveEdition?: (
    editionId: string,
    reason: string,
    correlationId: string,
    actor?: Readonly<{ id?: string; type: "admin" | "emergency_admin" }>,
  ) => Promise<{ changed: boolean; status: "scheduled" }>;
  readonly startQuizAttempt?: (
    gameId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<QuizAttemptState>;
  readonly startAttempt?: (
    gameId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<
    QuizAttemptState | CrosswordAttemptState | GuessWordAttemptState | WordSearchAttemptState
  >;
  readonly submitGuessWordGuess?: (
    attemptId: string,
    player: PlayerCredential,
    event: GuessWordGuessEvent,
    now: Date,
  ) => Promise<GuessWordGuessResult>;
  readonly submitWordSearchSelection?: (
    attemptId: string,
    player: PlayerCredential,
    event: WordSearchSelectionEvent,
    now: Date,
  ) => Promise<WordSearchSelectionResult>;
  readonly submitAttempt?: (
    attemptId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<QuizSubmitResult | CrosswordSubmitResult>;
  readonly submitQuizAttempt?: (
    attemptId: string,
    player: PlayerCredential,
    now: Date,
  ) => Promise<QuizSubmitResult>;
  readonly updateLeaderboardSettings?: (
    userId: string,
    settings: UserLeaderboardSettings,
    now: Date,
  ) => Promise<UserLeaderboardSettings>;
  readonly updateNotificationPreferences?: (
    userId: string,
    preferences: NotificationPreferences,
    now: Date,
  ) => Promise<NotificationPreferences>;
  readonly upsertWordBankEntry?: (
    input: Readonly<{
      answer: string;
      category: string;
      clue: string;
      difficulty: number;
      qualityScore: number;
      sourceCheckedAt: Date;
      sourceUrl: string;
      validationStatus: "approved" | "pending" | "rejected";
      variants: readonly string[];
    }>,
    actorId: string,
    reason: string,
    correlationId: string,
    now: Date,
  ) => Promise<WordBankRecord>;
  readonly updateConsent?: (
    player: PlayerCredential,
    choice: Pick<ConsentState, "ads" | "analytics" | "policyVersion">,
    source: "android" | "ios" | "web",
    now: Date,
  ) => Promise<ConsentState>;
  readonly resolveAdminAccessToken?: (token: string) => Promise<AdminPrincipal | null>;
  readonly reviewGeneratedContent?: (
    contentId: string,
    decision: "approved" | "rejected",
    actorId: string,
    reason: string,
    correlationId: string,
    now: Date,
  ) => Promise<{ changed: boolean; status: "approved" | "rejected" }>;
  readonly regenerateGeneratedContent?: (
    contentId: string,
    actorId: string,
    reason: string,
    correlationId: string,
    now: Date,
  ) => Promise<{ changed: boolean; jobId: string; status: "queued" }>;
  readonly reviseGeneratedContent?: (
    contentId: string,
    revision: Readonly<{ privatePayload: unknown; publicPayload: unknown; sources: unknown }>,
    actorId: string,
    reason: string,
    correlationId: string,
    now: Date,
  ) => Promise<GeneratedContentRecord>;
  readonly resolveUserAccessToken?: (token: string) => Promise<string | null>;
  readonly verifyUserAccessToken?: (token: string) => Promise<ExternalIdentity | null>;
}

export type PlayerCredential = { kind: "guest"; token: string } | { kind: "user"; userId: string };

export function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    bodyLimit: 256 * 1_024,
    genReqId: (request) => {
      const supplied = request.headers["x-correlation-id"];
      return typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)
        ? supplied
        : randomUUID();
    },
    logger: process.env.NODE_ENV !== "test",
  });
  const limiter = new FixedWindowRateLimiter();
  const responseMetrics = new Map<string, number>();
  const allowedOrigins = new Set(
    [options.publicWebUrl, ...(process.env.CORS_ALLOWED_ORIGINS ?? "").split(",")]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\/$/, "")),
  );

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      if (!allowedOrigins.has(origin)) return reply.code(403).send({ code: "ORIGIN_NOT_ALLOWED" });
      reply.headers({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
      });
    }
    if (request.method === "OPTIONS") {
      return reply
        .headers({
          "Access-Control-Allow-Headers":
            "Authorization,Content-Type,Idempotency-Key,X-Client-Platform,X-Correlation-Id,X-Guest-Token",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Max-Age": "600",
        })
        .code(204)
        .send();
    }
    if (!request.url.startsWith("/v1/")) return;
    const { bucket, limit } = rateLimitPolicy(request.method, request.url);
    const result = limiter.consume(`${request.ip}:${bucket}`, limit, Date.now());
    if (!result.allowed) {
      return reply
        .header("Retry-After", String(result.retryAfter))
        .code(429)
        .send({ code: "RATE_LIMITED" });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.headers({
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Correlation-Id": request.id,
      "X-Frame-Options": "DENY",
      ...(process.env.NODE_ENV === "production"
        ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
        : {}),
    });
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    if (route === "/metrics") return;
    const key = `${request.method}\u0000${route}\u0000${reply.statusCode}`;
    responseMetrics.set(key, (responseMetrics.get(key) ?? 0) + 1);
  });

  app.get<{ Reply: HealthResponse }>(
    "/health",
    { schema: { response: { 200: healthResponseSchema } } },
    async () => ({ status: "ok" }),
  );

  app.get("/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return (await options.isReady?.()) === false
        ? reply.code(503).send({ status: "unavailable" })
        : { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.get<{ Headers: { authorization?: string } }>("/metrics", async (request, reply) => {
    if (!hasAdminAccess(request.headers.authorization, options.metricsToken)) {
      return reply.code(404).send();
    }
    reply.headers({
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; version=0.0.4",
    });
    const lines = [...responseMetrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, count]) => {
        const [method, route, status] = key.split("\u0000");
        return `ludico_http_responses_total{method="${method}",route="${route}",status="${status}"} ${count}`;
      });
    return ["# TYPE ludico_http_responses_total counter", ...lines, ""].join("\n");
  });

  app.get<{ Reply: PublicEdition | { code: "EDITION_NOT_FOUND" } }>(
    "/v1/editions/today",
    { schema: { response: { 200: publicEditionSchema } } },
    async (_request, reply) => {
      const edition = await options.getTodayEdition?.((options.now ?? (() => new Date()))());
      if (!edition) {
        return reply.code(404).send({ code: "EDITION_NOT_FOUND" });
      }

      reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      return edition;
    },
  );

  app.get<{
    Params: { date: string };
    Reply: PublicEdition | { code: "EDITION_NOT_FOUND" };
  }>(
    "/v1/editions/:date",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["date"],
          properties: { date: { type: "string", format: "date" } },
        },
        response: { 200: publicEditionSchema },
      },
    },
    async (request, reply) => {
      const edition = await options.getEditionByDate?.(
        request.params.date,
        (options.now ?? (() => new Date()))(),
      );
      if (!edition) return reply.code(404).send({ code: "EDITION_NOT_FOUND" });
      reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
      return edition;
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Params: { id: string };
    Reply: string | { code: string };
  }>(
    "/v1/admin/content/:id/preview.svg",
    {
      schema: {
        headers: adminHeadersSchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (!options.getGeneratedContent) return reply.code(503).send({ code: "UNAVAILABLE" });
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "superadmin",
      ]);
      const content = await options.getGeneratedContent(request.params.id);
      if (!content) return reply.code(404).send({ code: "CONTENT_NOT_FOUND" });
      if (content.contentType !== "crossword" || !isCrosswordPublicPayload(content.publicPayload)) {
        return reply.code(409).send({ code: "PREVIEW_NOT_AVAILABLE" });
      }
      return reply
        .header("Cache-Control", "private, no-store")
        .type("image/svg+xml; charset=utf-8")
        .send(renderCrosswordSvg(content.publicPayload));
    },
  );

  app.get<{
    Params: { id: string };
    Reply: PublicSolution | { code: "GAME_NOT_FOUND" | "SOLUTION_LOCKED" };
  }>(
    "/v1/games/:id/solution",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: { 200: publicSolutionSchema },
      },
    },
    async (request, reply) => {
      const result = await options.getGameSolution?.(
        request.params.id,
        (options.now ?? (() => new Date()))(),
      );
      if (!result || result.status === "not_found") {
        return reply.code(404).send({ code: "GAME_NOT_FOUND" });
      }
      if (result.status === "locked") {
        reply.header("Cache-Control", "private, no-store");
        return reply.code(423).send({ code: "SOLUTION_LOCKED" });
      }

      reply.header("Cache-Control", "public, max-age=3600");
      return result.solution;
    },
  );

  app.get<{
    Params: { id: string };
    Headers: PlayerAuthHeaders;
    Reply: AttemptReview | { code: "ATTEMPT_NOT_FOUND" | "SOLUTION_LOCKED" | "UNAVAILABLE" };
  }>(
    "/v1/attempts/:id/review",
    {
      schema: {
        params: idParamsSchema,
        headers: playerAuthHeadersSchema,
        response: { 200: attemptReviewSchema },
      },
    },
    async (request, reply) => {
      if (!options.getAttemptReview) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      const result = await options.getAttemptReview(
        request.params.id,
        player,
        (options.now ?? (() => new Date()))(),
      );
      if (result.status === "not_found") {
        return reply.code(404).send({ code: "ATTEMPT_NOT_FOUND" });
      }
      if (result.status === "locked") return reply.code(423).send({ code: "SOLUTION_LOCKED" });
      return "review" in result ? result.review : reply.code(503).send({ code: "UNAVAILABLE" });
    },
  );

  app.get<{ Params: { id: string }; Reply: PublicGame | { code: "GAME_NOT_FOUND" } }>(
    "/v1/games/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: publicGameSchema },
      },
    },
    async (request, reply) => {
      const game = await options.getPublishedGame?.(
        request.params.id,
        (options.now ?? (() => new Date()))(),
      );
      if (!game) return reply.code(404).send({ code: "GAME_NOT_FOUND" });
      reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      return game;
    },
  );

  app.get<{
    Params: { key: string; scope: "daily" | "game" | "weekly" };
    Headers: PlayerAuthHeaders;
    Reply: Leaderboard | { code: "INVALID_KEY" | "UNAVAILABLE" };
  }>(
    "/v1/leaderboards/:scope/:key",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["scope", "key"],
          properties: {
            scope: { enum: ["daily", "game", "weekly"] },
            key: { type: "string", minLength: 10, maxLength: 36 },
          },
        },
        headers: playerAuthHeadersSchema,
        response: { 200: leaderboardSchema },
      },
    },
    async (request, reply) => {
      if (!validLeaderboardKey(request.params.scope, request.params.key)) {
        return reply.code(400).send({ code: "INVALID_KEY" });
      }
      if (!options.getLeaderboard) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const player = await resolvePlayer(request.headers, options);
      reply.header("Cache-Control", "private, no-store");
      return options.getLeaderboard(
        request.params.scope,
        request.params.key,
        player,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: StreakSummary | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/streaks",
    { schema: { headers: playerAuthHeadersSchema, response: { 200: streakSummarySchema } } },
    async (request, reply) => {
      if (!options.getStreak) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      const now = (options.now ?? (() => new Date()))();
      return options.getStreak(player.userId, dateInMadrid(now));
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: readonly PreviousResultSummary[] | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/previous-results",
    {
      schema: {
        headers: playerAuthHeadersSchema,
        response: { 200: previousResultSummariesSchema },
      },
    },
    async (request, reply) => {
      if (!options.getPreviousResults) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      return options.getPreviousResults(player.userId, (options.now ?? (() => new Date()))());
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: AccountDataExport | { code: "ACCOUNT_REQUIRED" | "NOT_FOUND" | "UNAVAILABLE" };
  }>(
    "/v1/me/data-export",
    {
      schema: {
        headers: playerAuthHeadersSchema,
        response: { 200: accountDataExportSchema },
      },
    },
    async (request, reply) => {
      if (!options.getAccountData) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      const data = await options.getAccountData(
        player.userId,
        (options.now ?? (() => new Date()))(),
      );
      if (!data) return reply.code(404).send({ code: "NOT_FOUND" });
      reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", 'attachment; filename="ludico-datos.json"');
      return data;
    },
  );

  app.delete<{
    Body: { confirmation: "ELIMINAR" };
    Headers: PlayerCommandHeaders;
    Reply: { deleted: true } | { code: "ACCOUNT_REQUIRED" | "NOT_FOUND" | "UNAVAILABLE" };
  }>(
    "/v1/me",
    {
      schema: {
        body: accountDeletionRequestSchema,
        headers: playerCommandHeadersSchema,
        response: { 200: accountDeletionResponseSchema },
      },
    },
    async (request, reply) => {
      if (!options.deleteAccount) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      const deleted = await options.deleteAccount(
        player.userId,
        request.id,
        (options.now ?? (() => new Date()))(),
      );
      if (!deleted) return reply.code(404).send({ code: "NOT_FOUND" });
      reply.header("Cache-Control", "private, no-store");
      return { deleted: true };
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: UserLeaderboardSettings | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/leaderboard-settings",
    {
      schema: {
        headers: playerAuthHeadersSchema,
        response: { 200: userLeaderboardSettingsSchema },
      },
    },
    async (request, reply) => {
      if (!options.getLeaderboardSettings) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      const settings = await options.getLeaderboardSettings(player.userId);
      if (!settings) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      return settings;
    },
  );

  app.patch<{
    Body: UserLeaderboardSettings;
    Headers: PlayerCommandHeaders;
    Reply: UserLeaderboardSettings | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/leaderboard-settings",
    {
      schema: {
        body: userLeaderboardSettingsSchema,
        headers: playerCommandHeadersSchema,
        response: { 200: userLeaderboardSettingsSchema },
      },
    },
    async (request, reply) => {
      if (!options.updateLeaderboardSettings) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      return options.updateLeaderboardSettings(
        player.userId,
        request.body,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: NotificationPreferences | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/notification-preferences",
    {
      schema: {
        headers: playerAuthHeadersSchema,
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (request, reply) => {
      if (!options.getNotificationPreferences) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      const preferences = await options.getNotificationPreferences(player.userId);
      if (!preferences) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      return preferences;
    },
  );

  app.patch<{
    Body: NotificationPreferences;
    Headers: PlayerCommandHeaders;
    Reply: NotificationPreferences | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/me/notification-preferences",
    {
      schema: {
        body: notificationPreferencesSchema,
        headers: playerCommandHeadersSchema,
        response: { 200: notificationPreferencesSchema },
      },
    },
    async (request, reply) => {
      if (!options.updateNotificationPreferences) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      return options.updateNotificationPreferences(
        player.userId,
        request.body,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Body: { platform: "android" | "ios"; token: string };
    Headers: PlayerCommandHeaders;
    Reply: { endpointId: string } | { code: "ACCOUNT_REQUIRED" | "UNAVAILABLE" };
  }>(
    "/v1/devices/push-token",
    {
      schema: {
        body: pushTokenSchema,
        headers: playerCommandHeadersSchema,
        response: { 200: pushEndpointSchema },
      },
    },
    async (request, reply) => {
      if (!options.registerPushEndpoint) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      if (player.kind !== "user") return reply.code(401).send({ code: "ACCOUNT_REQUIRED" });
      reply.header("Cache-Control", "private, no-store");
      return options.registerPushEndpoint(
        player.userId,
        request.body.token,
        request.body.platform,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.patch<{
    Body: {
      privatePayload: Record<string, unknown>;
      publicPayload: Record<string, unknown>;
      reason: string;
      sources: readonly Record<string, unknown>[];
    };
    Headers: AdminCommandHeaders;
    Params: { id: string };
    Reply: GeneratedContentRecord | { code: string };
  }>("/v1/admin/content/:id", { schema: adminContentRevisionSchema }, async (request, reply) => {
    if (!options.reviseGeneratedContent) return reply.code(503).send({ code: "UNAVAILABLE" });
    const now = (options.now ?? (() => new Date()))();
    const admin = await authorizeAdmin(
      request.headers,
      options,
      ["editor", "superadmin"],
      now,
      true,
    );
    reply.header("Cache-Control", "private, no-store");
    return options.reviseGeneratedContent(
      request.params.id,
      {
        privatePayload: request.body.privatePayload,
        publicPayload: request.body.publicPayload,
        sources: request.body.sources,
      },
      admin.userId,
      request.body.reason,
      request.headers["idempotency-key"],
      now,
    );
  });

  app.post<{
    Body: { attemptId: string };
    Headers: PlayerCommandHeaders;
    Reply: ShareResult | { code: "ATTEMPT_NOT_FOUND" | "UNAVAILABLE" };
  }>(
    "/v1/share-results",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["attemptId"],
          properties: { attemptId: { type: "string", format: "uuid" } },
        },
        headers: playerCommandHeadersSchema,
        response: { 200: shareResultSchema },
      },
    },
    async (request, reply) => {
      if (!options.getShareResultData) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      const data = await options.getShareResultData(
        request.body.attemptId,
        player,
        (options.now ?? (() => new Date()))(),
      );
      if (!data) return reply.code(404).send({ code: "ATTEMPT_NOT_FOUND" });
      reply.header("Cache-Control", "private, no-store");
      return {
        text: createShareText(data.gameType, data.points, data.competitive),
        url: `${(options.publicWebUrl ?? "http://localhost:3000").replace(/\/$/, "")}/resultados/${data.gameId}`,
      };
    },
  );

  app.get<{
    Headers: PlayerAuthHeaders;
    Reply: ConsentState | { code: "UNAVAILABLE" };
  }>(
    "/v1/consents/current",
    { schema: { headers: playerAuthHeadersSchema, response: { 200: consentStateSchema } } },
    async (request, reply) => {
      if (!options.getConsent) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      reply.header("Cache-Control", "private, no-store");
      return options.getConsent(player, (options.now ?? (() => new Date()))());
    },
  );

  app.post<{
    Body: Pick<ConsentState, "ads" | "analytics" | "policyVersion">;
    Headers: PlayerCommandHeaders & { "x-client-platform"?: "android" | "ios" | "web" };
    Reply: ConsentState | { code: "UNAVAILABLE" };
  }>(
    "/v1/consents",
    {
      schema: {
        body: consentChoiceSchema,
        headers: playerPlatformCommandHeadersSchema,
        response: { 200: consentStateSchema },
      },
    },
    async (request, reply) => {
      if (!options.updateConsent) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      reply.header("Cache-Control", "private, no-store");
      return options.updateConsent(
        player,
        request.body,
        request.headers["x-client-platform"] ?? "web",
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Body: { events: readonly AnalyticsEventInput[] };
    Headers: PlayerCommandHeaders;
    Reply: AnalyticsIngestResult | { code: "UNAVAILABLE" };
  }>(
    "/v1/analytics/events",
    {
      schema: {
        body: analyticsEventsSchema,
        headers: playerCommandHeadersSchema,
        response: { 200: analyticsIngestResultSchema },
      },
    },
    async (request, reply) => {
      if (!options.ingestAnalytics) return reply.code(503).send({ code: "UNAVAILABLE" });
      const player = await resolvePlayer(request.headers, options);
      reply.header("Cache-Control", "private, no-store");
      return options.ingestAnalytics(
        player,
        request.body.events,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Reply:
      | QuizAttemptState
      | CrosswordAttemptState
      | GuessWordAttemptState
      | WordSearchAttemptState
      | { code: "UNAVAILABLE" };
  }>(
    "/v1/games/:id/attempts",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        response: {
          200: {
            oneOf: [
              quizAttemptStateSchema,
              crosswordAttemptStateSchema,
              guessWordAttemptStateSchema,
              wordSearchAttemptStateSchema,
            ],
          },
        },
      },
    },
    async (request, reply) => {
      const startAttempt = options.startAttempt ?? options.startQuizAttempt;
      if (!startAttempt) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      return startAttempt(request.params.id, player, (options.now ?? (() => new Date()))());
    },
  );

  app.post<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Body: WordSearchSelectionEvent;
    Reply: WordSearchSelectionResult | { code: "UNAVAILABLE" };
  }>(
    "/v1/attempts/:id/word-search-selections",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        body: wordSearchSelectionEventSchema,
        response: { 200: wordSearchSelectionResultSchema },
      },
    },
    async (request, reply) => {
      if (!options.submitWordSearchSelection) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      return options.submitWordSearchSelection(
        request.params.id,
        player,
        request.body,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Body: GuessWordGuessEvent;
    Reply: GuessWordGuessResult | { code: "UNAVAILABLE" };
  }>(
    "/v1/attempts/:id/guesses",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["clientEventId", "elapsedMs", "guess", "version"],
          properties: {
            clientEventId: { type: "string", format: "uuid" },
            clientOccurredAt: { type: "string", format: "date-time" },
            elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
            guess: { type: "string", minLength: 3, maxLength: 21 },
            version: { type: "integer", minimum: 1 },
          },
        },
        response: { 200: guessWordGuessResultSchema },
      },
    },
    async (request, reply) => {
      if (!options.submitGuessWordGuess) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      return options.submitGuessWordGuess(
        request.params.id,
        player,
        request.body,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Headers: GuestMigrationHeaders;
    Reply: GuestMigrationResult | { code: "INVALID_ACCESS_TOKEN" | "UNAVAILABLE" };
  }>(
    "/v1/auth/migrate-guest",
    { schema: { headers: guestMigrationHeadersSchema } },
    async (request, reply) => {
      if (!options.verifyUserAccessToken || !options.migrateGuest) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const authorization = request.headers.authorization;
      if (!authorization.startsWith("Bearer ")) {
        return reply.code(401).send({ code: "INVALID_ACCESS_TOKEN" });
      }
      const identity = await options.verifyUserAccessToken(authorization.slice(7));
      if (!identity) return reply.code(401).send({ code: "INVALID_ACCESS_TOKEN" });
      reply.header("Cache-Control", "private, no-store");
      return options.migrateGuest(
        request.headers["x-guest-token"],
        identity,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.post<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Body: { cellId: string; clientEventId: string };
    Reply: CrosswordHintResult | { code: "UNAVAILABLE" };
  }>(
    "/v1/attempts/:id/hints",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["cellId", "clientEventId"],
          properties: {
            cellId: { type: "string", format: "uuid" },
            clientEventId: { type: "string", format: "uuid" },
          },
        },
        response: { 200: crosswordHintResultSchema },
      },
    },
    async (request, reply) => {
      if (!options.revealCrosswordCell) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      return options.revealCrosswordCell(
        request.params.id,
        player,
        request.body.cellId,
        request.body.clientEventId,
        (options.now ?? (() => new Date()))(),
      );
    },
  );

  app.put<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Body: { version: number; events: (QuizProgressEvent | CrosswordProgressEvent)[] };
    Reply:
      | { savedEvents: number; status: "saved"; version: number }
      | {
          code: "UNAVAILABLE" | "VERSION_CONFLICT";
          state?: QuizAttemptState | CrosswordAttemptState;
        };
  }>(
    "/v1/attempts/:id/progress",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        body: progressBodySchema,
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const now = (options.now ?? (() => new Date()))();
      const player = await resolvePlayer(request.headers, options);
      const result = options.saveProgress
        ? await options.saveProgress(
            request.params.id,
            player,
            request.body.version,
            request.body.events,
            now,
          )
        : options.saveQuizProgress && isQuizProgressEvents(request.body.events)
          ? await options.saveQuizProgress(
              request.params.id,
              player,
              request.body.version,
              request.body.events,
              now,
            )
          : undefined;
      if (!result) return reply.code(503).send({ code: "UNAVAILABLE" });
      return result.status === "conflict"
        ? reply.code(409).send({ code: "VERSION_CONFLICT", state: result.state })
        : result;
    },
  );

  app.post<{
    Params: { id: string };
    Headers: PlayerCommandHeaders;
    Reply: QuizSubmitResult | CrosswordSubmitResult | { code: "UNAVAILABLE" };
  }>(
    "/v1/attempts/:id/submit",
    {
      schema: {
        params: idParamsSchema,
        headers: playerCommandHeadersSchema,
        response: { 202: quizSubmitResultSchema },
      },
    },
    async (request, reply) => {
      const submitAttempt = options.submitAttempt ?? options.submitQuizAttempt;
      if (!submitAttempt) return reply.code(503).send({ code: "UNAVAILABLE" });
      reply.header("Cache-Control", "private, no-store");
      const player = await resolvePlayer(request.headers, options);
      const result = await submitAttempt(
        request.params.id,
        player,
        (options.now ?? (() => new Date()))(),
      );
      return reply.code(202).send(result);
    },
  );

  app.post<{
    Body: { origin: GuestOrigin };
    Headers: { "x-guest-token"?: string };
    Reply: GuestSessionCredential | { code: "INVALID_GUEST_TOKEN" | "UNAVAILABLE" };
  }>(
    "/v1/guest-sessions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["origin"],
          properties: { origin: { enum: ["web", "android", "ios"] } },
        },
        response: { 200: guestSessionCredentialSchema, 201: guestSessionCredentialSchema },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Pragma", "no-cache");
      const now = (options.now ?? (() => new Date()))();
      const currentToken = request.headers["x-guest-token"];

      try {
        if (currentToken) {
          if (!options.rotateGuestSession) return reply.code(503).send({ code: "UNAVAILABLE" });
          return await options.rotateGuestSession(currentToken, now);
        }
        if (!options.createGuestSession) return reply.code(503).send({ code: "UNAVAILABLE" });
        const credential = await options.createGuestSession(request.body.origin, now);
        return reply.code(201).send(credential);
      } catch (error) {
        if (error instanceof GuestTokenError) {
          return reply.code(401).send({ code: error.code });
        }
        throw error;
      }
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GuestTokenError) {
      return reply.code(401).send({ code: error.code });
    }
    if (error instanceof AuthProviderUnavailableError) {
      return reply.code(503).send({ code: "UNAVAILABLE" });
    }
    if (error instanceof PlayerAuthenticationError) {
      return reply.code(401).send({ code: error.code });
    }
    if (error instanceof LeaderboardSettingsError) {
      return reply.code(error.code === "USER_NOT_FOUND" ? 404 : 422).send({ code: error.code });
    }
    if (error instanceof PrivacyError) {
      return reply
        .code(error.code === "CONSENT_POLICY_OUTDATED" ? 409 : 422)
        .send({ code: error.code });
    }
    if (error instanceof AdminAuthenticationError) {
      return reply.code(error.code === "UNAUTHORIZED" ? 401 : 403).send({ code: error.code });
    }
    if (error instanceof ContentPipelineError) {
      const status = {
        BUDGET_EXCEEDED: 409,
        BLOCKED_TERM_NOT_FOUND: 404,
        CONTENT_NOT_FOUND: 404,
        CONTENT_NOT_REVIEWABLE: 409,
        EDITION_ALREADY_EXISTS: 409,
        EDITION_GAME_UNSUPPORTED: 409,
        INSUFFICIENT_APPROVED_CONTENT: 409,
        INVALID_BLOCKED_TERM: 422,
        INVALID_REASON: 422,
        JOB_NOT_RUNNING: 409,
        VALIDATION_FAILED: 422,
      }[error.code];
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof WordBankError) {
      return reply.code(error.code === "ENTRY_NOT_FOUND" ? 404 : 422).send({ code: error.code });
    }
    if (error instanceof NotificationSettingsError) {
      const status =
        error.code === "USER_NOT_FOUND"
          ? 404
          : error.code === "PUSH_ENCRYPTION_UNAVAILABLE"
            ? 503
            : 422;
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof QuizAttemptError) {
      const status = {
        ATTEMPT_NOT_EDITABLE: 409,
        ATTEMPT_NOT_FOUND: 404,
        GAME_UNAVAILABLE: 409,
        INVALID_ANSWER: 422,
        UNAUTHORIZED: 401,
      }[error.code];
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof CrosswordAttemptError) {
      const status = {
        ATTEMPT_NOT_EDITABLE: 409,
        ATTEMPT_NOT_FOUND: 404,
        GAME_UNAVAILABLE: 409,
        INVALID_CELL: 422,
        UNAUTHORIZED: 401,
      }[error.code];
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof GuessWordAttemptError) {
      const status = {
        ATTEMPT_NOT_EDITABLE: 409,
        ATTEMPT_NOT_FOUND: 404,
        GAME_UNAVAILABLE: 409,
        INVALID_GUESS: 422,
        UNAUTHORIZED: 401,
        VERSION_CONFLICT: 409,
      }[error.code];
      return reply.code(status).send({ code: error.code });
    }
    if (error instanceof WordSearchAttemptError) {
      const status = {
        ATTEMPT_NOT_EDITABLE: 409,
        ATTEMPT_NOT_FOUND: 404,
        GAME_UNAVAILABLE: 409,
        INVALID_SELECTION: 422,
        UNAUTHORIZED: 401,
        VERSION_CONFLICT: 409,
      }[error.code];
      return reply.code(status).send({ code: error.code });
    }
    const errorRecord =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    if ("validation" in errorRecord || errorRecord.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(errorRecord.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? 413 : 400).send({
        code:
          errorRecord.code === "FST_ERR_CTP_BODY_TOO_LARGE"
            ? "PAYLOAD_TOO_LARGE"
            : "INVALID_REQUEST",
      });
    }
    request.log.error({ err: error }, "request_failed");
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });

  app.delete<{
    Headers: { "x-guest-token": string };
  }>(
    "/v1/guest-sessions/current",
    {
      schema: {
        headers: {
          type: "object",
          required: ["x-guest-token"],
          properties: { "x-guest-token": { type: "string", minLength: 43, maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      if (options.revokeGuestSession) {
        await options.revokeGuestSession(
          request.headers["x-guest-token"],
          (options.now ?? (() => new Date()))(),
        );
      }
      return reply.code(204).send();
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Querystring: { status?: GeneratedContentRecord["status"] };
    Reply: readonly GeneratedContentRecord[] | { code: string };
  }>(
    "/v1/admin/content",
    {
      schema: {
        headers: adminHeadersSchema,
        querystring: adminContentQuerySchema,
        response: { 200: adminContentListSchema },
      },
    },
    async (request, reply) => {
      if (!options.listGeneratedContent) return reply.code(503).send({ code: "UNAVAILABLE" });
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "superadmin",
      ]);
      reply.header("Cache-Control", "private, no-store");
      return options.listGeneratedContent(request.query.status);
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Reply: readonly BlockedTermRecord[] | { code: string };
  }>(
    "/v1/admin/blocked-terms",
    {
      schema: { headers: adminHeadersSchema, response: { 200: blockedTermListSchema } },
    },
    async (request, reply) => {
      if (!options.listBlockedTerms) return reply.code(503).send({ code: "UNAVAILABLE" });
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "superadmin",
      ]);
      reply.header("Cache-Control", "private, no-store");
      return options.listBlockedTerms();
    },
  );

  app.post<{
    Body: { reason: string; term: string };
    Headers: AdminCommandHeaders;
    Reply: BlockedTermRecord | { code: string };
  }>(
    "/v1/admin/blocked-terms",
    {
      schema: {
        body: blockedTermUpsertSchema,
        headers: adminCommandHeadersSchema,
        response: { 200: blockedTermSchema },
      },
    },
    async (request, reply) => {
      if (!options.upsertBlockedTerm) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "moderator", "superadmin"],
        now,
        true,
      );
      reply.header("Cache-Control", "private, no-store");
      return options.upsertBlockedTerm(
        request.body.term,
        request.body.reason,
        admin.userId,
        request.headers["idempotency-key"],
        now,
      );
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Reply: readonly WordBankRecord[] | { code: string };
  }>(
    "/v1/admin/word-bank",
    {
      schema: { headers: adminHeadersSchema, response: { 200: wordBankListSchema } },
    },
    async (request, reply) => {
      if (!options.listCuratedWordBank) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "superadmin",
      ]);
      reply.header("Cache-Control", "private, no-store");
      return options.listCuratedWordBank(now);
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Querystring: { days?: number };
    Reply: AnalyticsDashboard | { code: string };
  }>(
    "/v1/admin/analytics/dashboard",
    {
      schema: {
        headers: adminHeadersSchema,
        querystring: analyticsDashboardQuerySchema,
        response: { 200: analyticsDashboardSchema },
      },
    },
    async (request, reply) => {
      if (!options.getAnalyticsDashboard) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "support",
        "superadmin",
      ]);
      reply.header("Cache-Control", "private, no-store");
      return options.getAnalyticsDashboard(request.query.days ?? 7, now);
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Querystring: { limit?: number };
    Reply: readonly AdminAuditRecord[] | { code: string };
  }>(
    "/v1/admin/audit",
    {
      schema: {
        headers: adminHeadersSchema,
        querystring: adminAuditQuerySchema,
        response: { 200: adminAuditListSchema },
      },
    },
    async (request, reply) => {
      if (!options.listAdminAudit) return reply.code(503).send({ code: "UNAVAILABLE" });
      await authorizeAdmin(request.headers, options, ["superadmin"]);
      reply.header("Cache-Control", "private, no-store");
      return options.listAdminAudit(request.query.limit ?? 50);
    },
  );

  app.post<{
    Body: {
      answer: string;
      category: string;
      clue: string;
      difficulty: number;
      qualityScore: number;
      reason: string;
      sourceCheckedAt: string;
      sourceUrl: string;
      validationStatus: "approved" | "pending" | "rejected";
      variants: string[];
    };
    Headers: AdminCommandHeaders;
    Reply: WordBankRecord | { code: string };
  }>(
    "/v1/admin/word-bank",
    {
      schema: {
        body: wordBankUpsertSchema,
        headers: adminCommandHeadersSchema,
        response: { 200: wordBankSchema },
      },
    },
    async (request, reply) => {
      if (!options.upsertWordBankEntry) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "superadmin"],
        now,
        true,
      );
      const { reason, sourceCheckedAt, ...input } = request.body;
      reply.header("Cache-Control", "private, no-store");
      return options.upsertWordBankEntry(
        { ...input, sourceCheckedAt: new Date(sourceCheckedAt) },
        admin.userId,
        reason,
        request.headers["idempotency-key"],
        now,
      );
    },
  );

  app.post<{
    Body: { reason: string };
    Headers: AdminCommandHeaders;
    Params: { id: string };
    Reply: { active: false; changed: boolean; id: string } | { code: string };
  }>(
    "/v1/admin/word-bank/:id/deactivate",
    { schema: wordBankDeactivateSchema },
    async (request, reply) => {
      if (!options.deactivateWordBankEntry) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "superadmin"],
        now,
        true,
      );
      reply.header("Cache-Control", "private, no-store");
      return options.deactivateWordBankEntry(
        request.params.id,
        admin.userId,
        request.body.reason,
        request.headers["idempotency-key"],
        now,
      );
    },
  );

  app.post<{
    Body: { reason: string };
    Headers: AdminCommandHeaders;
    Params: { id: string };
    Reply: { active: false; changed: boolean; id: string } | { code: string };
  }>(
    "/v1/admin/blocked-terms/:id/deactivate",
    { schema: blockedTermDeactivateSchema },
    async (request, reply) => {
      if (!options.deactivateBlockedTerm) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "moderator", "superadmin"],
        now,
        true,
      );
      reply.header("Cache-Control", "private, no-store");
      return options.deactivateBlockedTerm(
        request.params.id,
        request.body.reason,
        admin.userId,
        request.headers["idempotency-key"],
        now,
      );
    },
  );

  app.get<{
    Headers: AdminHeaders;
    Reply: AdminContentCalendar | { code: string };
  }>(
    "/v1/admin/editions/calendar",
    {
      schema: {
        headers: adminHeadersSchema,
        response: { 200: adminContentCalendarSchema },
      },
    },
    async (request, reply) => {
      if (!options.getAdminContentCalendar) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      await authorizeAdmin(request.headers, options, [
        "analyst",
        "editor",
        "moderator",
        "read_only",
        "superadmin",
      ]);
      reply.header("Cache-Control", "private, no-store");
      return options.getAdminContentCalendar();
    },
  );

  app.post<{
    Body: { budgetMicros: number; days: number; startDate: string };
    Headers: AdminCommandHeaders;
    Reply: readonly ContentJob[] | { code: string };
  }>(
    "/v1/admin/content/plan",
    {
      schema: {
        body: adminContentPlanSchema,
        headers: adminCommandHeadersSchema,
        response: { 200: contentJobListSchema },
      },
    },
    async (request, reply) => {
      if (!options.planContentJobs) return reply.code(503).send({ code: "UNAVAILABLE" });
      const now = (options.now ?? (() => new Date()))();
      await authorizeAdmin(request.headers, options, ["editor", "superadmin"], now, true);
      reply.header("Cache-Control", "private, no-store");
      return options.planContentJobs(
        request.body.startDate,
        request.body.days,
        request.body.budgetMicros,
      );
    },
  );

  app.post<{
    Body: { reason: string };
    Headers: AdminCommandHeaders;
    Params: { decision: "approve" | "regenerate" | "reject"; id: string };
    Reply:
      | { changed: boolean; jobId: string; status: "queued" }
      | { changed: boolean; status: "approved" | "rejected" }
      | { code: string };
  }>(
    "/v1/admin/content/:id/:decision",
    { schema: adminContentDecisionSchema },
    async (request, reply) => {
      if (request.params.decision === "regenerate" && !options.regenerateGeneratedContent) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      if (request.params.decision !== "regenerate" && !options.reviewGeneratedContent) {
        return reply.code(503).send({ code: "UNAVAILABLE" });
      }
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "superadmin"],
        now,
        true,
      );
      reply.header("Cache-Control", "private, no-store");
      if (request.params.decision === "regenerate") {
        return options.regenerateGeneratedContent!(
          request.params.id,
          admin.userId,
          request.body.reason,
          request.headers["idempotency-key"],
          now,
        );
      }
      return options.reviewGeneratedContent!(
        request.params.id,
        request.params.decision === "approve" ? "approved" : "rejected",
        admin.userId,
        request.body.reason,
        request.headers["idempotency-key"],
        now,
      );
    },
  );

  app.post<{
    Params: { id: string };
    Body: { reason: string };
    Headers: { authorization?: string; "idempotency-key": string };
    Reply:
      | { changed: boolean; status: "scheduled" }
      | { code: "EDITION_NOT_READY" | "UNAVAILABLE" | "UNAUTHORIZED" };
  }>("/v1/admin/editions/:id/schedule", { schema: adminCommandSchema }, async (request, reply) => {
    if (!options.scheduleReserveEdition) return reply.code(503).send({ code: "UNAVAILABLE" });
    const emergency = hasAdminAccess(request.headers.authorization, options.adminApiKey);
    let actor: Readonly<{ id?: string; type: "admin" | "emergency_admin" }> = {
      type: "emergency_admin",
    };
    if (!emergency) {
      if (!options.resolveAdminAccessToken) {
        return reply.code(401).send({ code: "UNAUTHORIZED" });
      }
      const now = (options.now ?? (() => new Date()))();
      const admin = await authorizeAdmin(
        request.headers,
        options,
        ["editor", "superadmin"],
        now,
        true,
      );
      actor = { id: admin.userId, type: "admin" };
    }
    try {
      return await options.scheduleReserveEdition(
        request.params.id,
        request.body.reason,
        request.headers["idempotency-key"] ?? request.id,
        actor,
      );
    } catch (error) {
      if (error instanceof AdminCommandError && error.code === "EDITION_NOT_READY") {
        return reply.code(409).send({ code: error.code });
      }
      throw error;
    }
  });

  app.post<{
    Params: { id: string };
    Body: { reason: string };
    Headers: { authorization?: string; "idempotency-key": string };
    Reply:
      | { changed: boolean; status: "disabled" }
      | { code: "GAME_NOT_FOUND" | "UNAVAILABLE" | "UNAUTHORIZED" };
  }>("/v1/admin/games/:id/disable", { schema: adminCommandSchema }, async (request, reply) => {
    if (!hasAdminAccess(request.headers.authorization, options.adminApiKey)) {
      return reply.code(401).send({ code: "UNAUTHORIZED" });
    }
    if (!options.disableGame) return reply.code(503).send({ code: "UNAVAILABLE" });
    try {
      return await options.disableGame(
        request.params.id,
        request.body.reason,
        request.headers["idempotency-key"] ?? request.id,
      );
    } catch (error) {
      if (error instanceof AdminCommandError && error.code === "GAME_NOT_FOUND") {
        return reply.code(404).send({ code: error.code });
      }
      throw error;
    }
  });

  return app;
}

function rateLimitPolicy(method: string, url: string): { bucket: string; limit: number } {
  if (url.startsWith("/v1/guest-sessions")) return { bucket: "guest-session", limit: 10 };
  if (url.startsWith("/v1/analytics/events")) return { bucket: "analytics", limit: 30 };
  if (url.startsWith("/v1/admin/")) return { bucket: "admin", limit: 30 };
  return method === "GET" ? { bucket: "read", limit: 300 } : { bucket: "command", limit: 120 };
}

const adminCommandSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 10, maxLength: 500 } },
  },
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  headers: {
    type: "object",
    required: ["idempotency-key"],
    properties: { "idempotency-key": { type: "string", minLength: 8, maxLength: 100 } },
  },
} as const;

interface PlayerCommandHeaders extends PlayerAuthHeaders {
  "idempotency-key": string;
}

interface PlayerAuthHeaders {
  authorization?: string;
  "x-guest-token"?: string;
}

interface GuestMigrationHeaders {
  authorization: string;
  "idempotency-key": string;
  "x-guest-token": string;
}

interface AdminHeaders {
  authorization?: string;
}

interface AdminCommandHeaders extends AdminHeaders {
  "idempotency-key": string;
}

const adminHeadersSchema = {
  type: "object",
  required: ["authorization"],
  properties: { authorization: { type: "string", minLength: 8 } },
} as const;

const adminCommandHeadersSchema = {
  ...adminHeadersSchema,
  required: ["authorization", "idempotency-key"],
  properties: {
    ...adminHeadersSchema.properties,
    "idempotency-key": { type: "string", minLength: 8, maxLength: 100 },
  },
} as const;

const adminContentQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { enum: ["approved", "pending_review", "rejected", "selected"] },
  },
} as const;

const analyticsDashboardQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: { days: { type: "integer", minimum: 1, maximum: 30 } },
} as const;

const adminAuditQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
} as const;

const adminAuditRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "action",
    "actorId",
    "actorType",
    "correlationId",
    "id",
    "occurredAt",
    "reason",
    "targetId",
    "targetType",
  ],
  properties: {
    action: { type: "string", minLength: 1, maxLength: 100 },
    actorId: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
    actorType: { type: "string", minLength: 1, maxLength: 100 },
    correlationId: { type: "string", minLength: 1, maxLength: 200 },
    id: { type: "string", format: "uuid" },
    occurredAt: { type: "string", format: "date-time" },
    reason: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }] },
    targetId: { type: "string", minLength: 1, maxLength: 200 },
    targetType: { type: "string", minLength: 1, maxLength: 100 },
  },
} as const;

const adminAuditListSchema = {
  type: "array",
  maxItems: 200,
  items: adminAuditRecordSchema,
} as const;

const analyticsDashboardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["daily", "definitions", "freshness", "generatedAt", "owner", "period", "totals"],
  properties: {
    daily: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["activeSubjects", "completions", "localDate", "starts"],
        properties: {
          activeSubjects: { type: "integer", minimum: 0 },
          completions: { type: "integer", minimum: 0 },
          localDate: { type: "string", format: "date" },
          starts: { type: "integer", minimum: 0 },
        },
      },
    },
    definitions: {
      type: "object",
      additionalProperties: false,
      required: ["activeSubjects", "completionRate"],
      properties: {
        activeSubjects: { type: "string", minLength: 1, maxLength: 200 },
        completionRate: { type: "string", minLength: 1, maxLength: 200 },
      },
    },
    freshness: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    generatedAt: { type: "string", format: "date-time" },
    owner: { const: "Product/Data" },
    period: {
      type: "object",
      additionalProperties: false,
      required: ["days", "from", "to"],
      properties: {
        days: { type: "integer", minimum: 1, maximum: 30 },
        from: { type: "string", format: "date" },
        to: { type: "string", format: "date" },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: [
        "activeSubjects",
        "completionRate",
        "completions",
        "quarantinedBatches",
        "registrations",
        "shares",
        "starts",
      ],
      properties: {
        activeSubjects: { type: "integer", minimum: 0 },
        completionRate: {
          anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }],
        },
        completions: { type: "integer", minimum: 0 },
        quarantinedBatches: { type: "integer", minimum: 0 },
        registrations: { type: "integer", minimum: 0 },
        shares: { type: "integer", minimum: 0 },
        starts: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

const adminContentPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["budgetMicros", "days", "startDate"],
  properties: {
    budgetMicros: { type: "integer", minimum: 0, maximum: 10_000_000 },
    days: { type: "integer", minimum: 1, maximum: 21 },
    startDate: { type: "string", format: "date" },
  },
} as const;

const adminContentDecisionSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 10, maxLength: 500 } },
  },
  headers: adminCommandHeadersSchema,
  params: {
    type: "object",
    additionalProperties: false,
    required: ["decision", "id"],
    properties: {
      decision: { enum: ["approve", "regenerate", "reject"] },
      id: { type: "string", format: "uuid" },
    },
  },
} as const;

const blockedTermSchema = {
  type: "object",
  additionalProperties: false,
  required: ["active", "id", "normalizedTerm", "reason"],
  properties: {
    active: { type: "boolean" },
    id: { type: "string", format: "uuid" },
    normalizedTerm: { type: "string", minLength: 2, maxLength: 80 },
    reason: { type: "string", minLength: 10, maxLength: 500 },
  },
} as const;

const blockedTermListSchema = { type: "array", items: blockedTermSchema } as const;

const blockedTermUpsertSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reason", "term"],
  properties: {
    reason: { type: "string", minLength: 10, maxLength: 500 },
    term: { type: "string", minLength: 2, maxLength: 80 },
  },
} as const;

const blockedTermDeactivateSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 10, maxLength: 500 } },
  },
  headers: adminCommandHeadersSchema,
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["active", "changed", "id"],
      properties: {
        active: { const: false },
        changed: { type: "boolean" },
        id: { type: "string", format: "uuid" },
      },
    },
  },
} as const;

const wordBankSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "active",
    "answer",
    "category",
    "clue",
    "difficulty",
    "id",
    "letterCount",
    "locale",
    "qualityScore",
    "sourceCheckedAt",
    "sourceUrl",
    "validationStatus",
    "variants",
  ],
  properties: {
    active: { type: "boolean" },
    answer: { type: "string", minLength: 2, maxLength: 21 },
    category: { type: "string", minLength: 2, maxLength: 80 },
    clue: { type: "string", minLength: 3, maxLength: 240 },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    id: { type: "string", format: "uuid" },
    letterCount: { type: "integer", minimum: 2, maximum: 21 },
    locale: { const: "es-ES" },
    qualityScore: { type: "integer", minimum: 0, maximum: 100 },
    sourceCheckedAt: { type: "string", format: "date-time" },
    sourceUrl: { type: "string", format: "uri", maxLength: 2_048 },
    validationStatus: { enum: ["approved", "pending", "rejected"] },
    variants: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 21 },
    },
  },
} as const;

const wordBankListSchema = { type: "array", items: wordBankSchema } as const;

const wordBankUpsertSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer",
    "category",
    "clue",
    "difficulty",
    "qualityScore",
    "reason",
    "sourceCheckedAt",
    "sourceUrl",
    "validationStatus",
    "variants",
  ],
  properties: {
    answer: { type: "string", minLength: 2, maxLength: 21 },
    category: { type: "string", minLength: 2, maxLength: 80 },
    clue: { type: "string", minLength: 3, maxLength: 240 },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    qualityScore: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string", minLength: 10, maxLength: 500 },
    sourceCheckedAt: { type: "string", format: "date-time" },
    sourceUrl: { type: "string", format: "uri", maxLength: 2_048 },
    validationStatus: { enum: ["approved", "pending", "rejected"] },
    variants: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 21 },
    },
  },
} as const;

const wordBankDeactivateSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["reason"],
    properties: { reason: { type: "string", minLength: 10, maxLength: 500 } },
  },
  headers: adminCommandHeadersSchema,
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["active", "changed", "id"],
      properties: {
        active: { const: false },
        changed: { type: "boolean" },
        id: { type: "string", format: "uuid" },
      },
    },
  },
} as const;

const adminContentRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "contentType",
    "targetDate",
    "status",
    "publicPayload",
    "privatePayload",
    "sources",
    "findings",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    contentType: { enum: ["crossword", "quiz", "true_false", "guess_word", "word_search"] },
    targetDate: { type: "string", format: "date" },
    status: { enum: ["approved", "pending_review", "rejected", "selected"] },
    publicPayload: { type: "object", additionalProperties: true },
    privatePayload: { type: "object", additionalProperties: true },
    sources: { type: "array", items: { type: "object", additionalProperties: true } },
    findings: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;

const adminContentRevisionSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["privatePayload", "publicPayload", "reason", "sources"],
    properties: {
      privatePayload: { type: "object", additionalProperties: true },
      publicPayload: { type: "object", additionalProperties: true },
      reason: { type: "string", minLength: 10, maxLength: 500 },
      sources: {
        type: "array",
        maxItems: 100,
        items: { type: "object", additionalProperties: true },
      },
    },
  },
  headers: adminCommandHeadersSchema,
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
  response: { 200: adminContentRecordSchema },
} as const;

const adminContentListSchema = {
  type: "array",
  items: adminContentRecordSchema,
} as const;

const adminContentCalendarSchema = {
  type: "object",
  additionalProperties: false,
  required: ["editions", "reserve"],
  properties: {
    editions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["gameCount", "id", "localDate", "status"],
        properties: {
          gameCount: { type: "integer", minimum: 0 },
          id: { type: "string", format: "uuid" },
          localDate: { type: "string", format: "date" },
          status: { type: "string" },
        },
      },
    },
    reserve: {
      type: "object",
      additionalProperties: false,
      required: ["crossword", "quiz", "true_false", "guess_word", "word_search"],
      properties: {
        crossword: { type: "integer", minimum: 0 },
        quiz: { type: "integer", minimum: 0 },
        true_false: { type: "integer", minimum: 0 },
        guess_word: { type: "integer", minimum: 0 },
        word_search: { type: "integer", minimum: 0 },
      },
    },
  },
} as const;

const contentJobListSchema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["id", "contentType", "targetDate", "provider", "promptVersion", "budgetMicros"],
    properties: {
      id: { type: "string", format: "uuid" },
      contentType: { enum: ["crossword", "quiz", "true_false", "guess_word", "word_search"] },
      targetDate: { type: "string", format: "date" },
      provider: { type: "string" },
      promptVersion: { type: "string" },
      budgetMicros: { type: "integer", minimum: 0 },
    },
  },
} as const;

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

const playerCommandHeadersSchema = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    authorization: { type: "string", minLength: 8 },
    "x-guest-token": { type: "string", minLength: 43, maxLength: 64 },
    "idempotency-key": { type: "string", minLength: 8, maxLength: 100 },
  },
} as const;

const playerPlatformCommandHeadersSchema = {
  ...playerCommandHeadersSchema,
  properties: {
    ...playerCommandHeadersSchema.properties,
    "x-client-platform": { enum: ["android", "ios", "web"] },
  },
} as const;

const consentChoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ads", "analytics", "policyVersion"],
  properties: {
    ads: { type: "boolean" },
    analytics: { type: "boolean" },
    policyVersion: { type: "string", minLength: 1, maxLength: 40 },
  },
} as const;

const pushTokenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["platform", "token"],
  properties: {
    platform: { enum: ["android", "ios"] },
    token: { type: "string", minLength: 20, maxLength: 256 },
  },
} as const;

const pushEndpointSchema = {
  type: "object",
  additionalProperties: false,
  required: ["endpointId"],
  properties: { endpointId: { type: "string", format: "uuid" } },
} as const;

const accountDeletionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["confirmation"],
  properties: { confirmation: { const: "ELIMINAR" } },
} as const;

const playerAuthHeadersSchema = {
  type: "object",
  properties: {
    authorization: { type: "string", minLength: 8 },
    "x-guest-token": { type: "string", minLength: 43, maxLength: 64 },
  },
} as const;

const guestMigrationHeadersSchema = {
  type: "object",
  required: ["authorization", "x-guest-token", "idempotency-key"],
  properties: {
    authorization: { type: "string", minLength: 8 },
    "x-guest-token": { type: "string", minLength: 43, maxLength: 64 },
    "idempotency-key": { type: "string", minLength: 8, maxLength: 100 },
  },
} as const;

const progressEnvelope = (eventSchema: object) => ({
  type: "object",
  additionalProperties: false,
  required: ["version", "events"],
  properties: {
    version: { type: "integer", minimum: 1 },
    events: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: eventSchema,
    },
  },
});

const eventProperties = {
  clientEventId: { type: "string", format: "uuid" },
  elapsedMs: { type: "integer", minimum: 0, maximum: 3_600_000 },
  clientOccurredAt: { type: "string", format: "date-time" },
} as const;

const progressBodySchema = {
  oneOf: [
    progressEnvelope({
      type: "object",
      additionalProperties: false,
      required: ["clientEventId", "questionId", "selectedOptionId", "elapsedMs"],
      properties: {
        ...eventProperties,
        questionId: { type: "string", format: "uuid" },
        selectedOptionId: { type: "string", format: "uuid" },
      },
    }),
    progressEnvelope({
      type: "object",
      additionalProperties: false,
      required: ["clientEventId", "cellId", "value", "elapsedMs"],
      properties: {
        ...eventProperties,
        cellId: { type: "string", format: "uuid" },
        value: { type: "string", minLength: 0, maxLength: 2 },
      },
    }),
  ],
} as const;

class PlayerAuthenticationError extends Error {
  constructor(readonly code: "INVALID_ACCESS_TOKEN" | "UNAUTHORIZED") {
    super(code);
  }
}

class AdminAuthenticationError extends Error {
  constructor(readonly code: "ADMIN_REAUTH_REQUIRED" | "FORBIDDEN" | "UNAUTHORIZED") {
    super(code);
  }
}

async function authorizeAdmin(
  headers: AdminHeaders,
  options: AppOptions,
  allowedRoles: readonly AdminPrincipal["role"][],
  now = (options.now ?? (() => new Date()))(),
  requireRecentReauthentication = false,
): Promise<AdminPrincipal> {
  if (!headers.authorization?.startsWith("Bearer ")) {
    throw new AdminAuthenticationError("UNAUTHORIZED");
  }
  if (!options.resolveAdminAccessToken) {
    throw new AuthProviderUnavailableError("La autenticación administrativa no está configurada");
  }
  const principal = await options.resolveAdminAccessToken(headers.authorization.slice(7));
  if (!principal) throw new AdminAuthenticationError("UNAUTHORIZED");
  if (!allowedRoles.includes(principal.role)) throw new AdminAuthenticationError("FORBIDDEN");
  if (requireRecentReauthentication) {
    const reauthenticatedAt = Date.parse(principal.reauthenticatedAt ?? "");
    if (
      !Number.isFinite(reauthenticatedAt) ||
      reauthenticatedAt > now.getTime() + 60_000 ||
      reauthenticatedAt < now.getTime() - 15 * 60_000
    ) {
      throw new AdminAuthenticationError("ADMIN_REAUTH_REQUIRED");
    }
  }
  return principal;
}

async function resolvePlayer(
  headers: PlayerAuthHeaders,
  options: AppOptions,
): Promise<PlayerCredential> {
  const authorization = headers.authorization;
  const guestToken = headers["x-guest-token"];
  if (!!authorization === !!guestToken) throw new PlayerAuthenticationError("UNAUTHORIZED");
  if (guestToken) return { kind: "guest", token: guestToken };
  if (!authorization?.startsWith("Bearer ")) {
    throw new PlayerAuthenticationError("INVALID_ACCESS_TOKEN");
  }
  if (!options.resolveUserAccessToken) {
    throw new AuthProviderUnavailableError("La autenticación de usuario no está configurada");
  }
  const userId = await options.resolveUserAccessToken(authorization.slice(7));
  if (!userId) throw new PlayerAuthenticationError("INVALID_ACCESS_TOKEN");
  return { kind: "user", userId };
}

function isQuizProgressEvents(
  events: readonly (QuizProgressEvent | CrosswordProgressEvent)[],
): events is readonly QuizProgressEvent[] {
  return events.every((event) => "questionId" in event);
}

function validLeaderboardKey(scope: "daily" | "game" | "weekly", key: string): boolean {
  return scope === "game"
    ? /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
    : /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function dateInMadrid(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function hasAdminAccess(authorization: string | undefined, expected: string | undefined): boolean {
  if (!authorization?.startsWith("Bearer ") || !expected) return false;
  const actualHash = createHash("sha256").update(authorization.slice(7)).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
