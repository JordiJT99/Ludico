import {
  createGuestSession,
  deactivateBlockedTerm,
  deactivateWordBankEntry,
  deleteUserAccount,
  disableGame,
  getAttemptGameType,
  getAnalyticsDashboard,
  getEditionByDate,
  getAdminContentCalendar,
  getContentGenerationHealth,
  getPublicationSettings,
  getGuestConsent,
  getGuestAttemptReview,
  getGuestLeaderboard,
  getGuestShareResultData,
  getUserAccountData,
  getUserAttemptReview,
  getUserConsent,
  getUserIdForIdentity,
  getGameSolution,
  getGeneratedContent,
  getPublishedGame,
  getPublishedEdition,
  getUserLeaderboard,
  getUserLeaderboardSettings,
  getUserNotificationPreferences,
  getUserPreviousResults,
  getPlayerProgression,
  getUserShareResultData,
  getUserStreak,
  listGeneratedContent,
  listBlockedTerms,
  listAdminAudit,
  listCuratedWordBank,
  migrateGuestToUser,
  planContentGenerationJobs,
  ingestGuestAnalytics,
  ingestUserAnalytics,
  isValidPushEncryptionKey,
  PostgresClient,
  QuizAttemptError,
  recordGuestGuessWordGuess,
  revokeGuestSession,
  registerUserPushEndpoint,
  regenerateGeneratedContent,
  reviseGeneratedContent,
  revealGuestCrosswordCell,
  revealUserCrosswordCell,
  rotateGuestSession,
  recordUserGuessWordGuess,
  recordGuestWordSearchSelection,
  recordUserWordSearchSelection,
  saveGuestCrosswordProgress,
  saveGuestQuizProgress,
  saveUserCrosswordProgress,
  saveUserQuizProgress,
  scheduleReserveEdition,
  startGuestCrosswordAttempt,
  startGuestGuessWordAttempt,
  startGuestQuizAttempt,
  startUserCrosswordAttempt,
  startUserGuessWordAttempt,
  startGuestWordSearchAttempt,
  startUserWordSearchAttempt,
  startUserQuizAttempt,
  submitGuestQuizAttempt,
  submitGuestCrosswordAttempt,
  submitUserCrosswordAttempt,
  submitUserQuizAttempt,
  reviewGeneratedContent,
  updateGuestConsent,
  updateUserConsent,
  updateUserLeaderboardSettings,
  updateUserNotificationPreferences,
  updatePublicationSettings,
  upsertBlockedTerm,
  upsertWordBankEntry,
} from "@ludico/database";
import type { CrosswordProgressEvent, QuizProgressEvent } from "@ludico/contracts";
import { buildApp } from "./app.js";
import { verifySupabaseAccessToken, verifySupabaseAdminAccessToken } from "./supabase-auth.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL es obligatoria");
const adminApiKey = process.env.ADMIN_API_KEY;
if (!adminApiKey || adminApiKey.length < 32) {
  throw new Error("ADMIN_API_KEY debe tener al menos 32 caracteres");
}
const metricsToken = process.env.METRICS_TOKEN;
if (metricsToken && metricsToken.length < 32) {
  throw new Error("METRICS_TOKEN debe tener al menos 32 caracteres");
}

const database = new PostgresClient(connectionString);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const contentProvider = process.env.AI_PROVIDER ?? "disabled";
if (
  !(["disabled", "deterministic", "fake", "openai"] as const).includes(contentProvider as never)
) {
  throw new Error("AI_PROVIDER no soportado; use disabled, deterministic, openai o fake");
}
const pushProvider = process.env.PUSH_PROVIDER ?? "disabled";
if (pushProvider !== "disabled" && pushProvider !== "expo" && pushProvider !== "fake") {
  throw new Error("PUSH_PROVIDER no soportado; use disabled, expo o fake");
}
const pushEncryptionKey = process.env.NOTIFICATION_TOKEN_KEY_BASE64;
const app = buildApp({
  adminApiKey,
  metricsToken,
  createGuestSession: (origin, now) => createGuestSession(database, origin, now),
  deleteAccount: (userId, correlationId, now) =>
    deleteUserAccount(database, userId, correlationId, now),
  disableGame: (gameId, reason, correlationId) =>
    disableGame(database, gameId, reason, correlationId),
  getTodayEdition: (now) => getPublishedEdition(database, now),
  getEditionByDate: (localDate, now) => getEditionByDate(database, localDate, now),
  getAdminContentCalendar: () => getAdminContentCalendar(database),
  getContentGenerationHealth: (now) => getContentGenerationHealth(database, now),
  getPublicationSettings: () => getPublicationSettings(database),
  getAnalyticsDashboard: (days, now) => getAnalyticsDashboard(database, now, days),
  getAccountData: (userId, now) => getUserAccountData(database, userId, now),
  getGameSolution: (gameId, now) => getGameSolution(database, gameId, now),
  getGeneratedContent: (contentId) => getGeneratedContent(database, contentId),
  getAttemptReview: (attemptId, player, now) =>
    player.kind === "guest"
      ? getGuestAttemptReview(database, attemptId, player.token, now)
      : getUserAttemptReview(database, attemptId, player.userId, now),
  getConsent: (player, now) =>
    player.kind === "guest"
      ? getGuestConsent(database, player.token, now)
      : getUserConsent(database, player.userId),
  getPublishedGame: (gameId, now) => getPublishedGame(database, gameId, now),
  getLeaderboard: (scope, key, player, now) =>
    player.kind === "guest"
      ? getGuestLeaderboard(database, scope, key, player.token, now)
      : getUserLeaderboard(database, scope, key, player.userId),
  getLeaderboardSettings: (userId) => getUserLeaderboardSettings(database, userId),
  getNotificationPreferences: (userId) => getUserNotificationPreferences(database, userId),
  getStreak: (userId, today) => getUserStreak(database, userId, today),
  getPreviousResults: (userId, now) => getUserPreviousResults(database, userId, now),
  getProgression: (player, now) => getPlayerProgression(database, player, now),
  getShareResultData: (attemptId, player, now) =>
    player.kind === "guest"
      ? getGuestShareResultData(database, attemptId, player.token, now)
      : getUserShareResultData(database, attemptId, player.userId),
  ingestAnalytics: (player, events, now) =>
    player.kind === "guest"
      ? ingestGuestAnalytics(database, player.token, events, now)
      : ingestUserAnalytics(database, player.userId, events, now),
  isReady: async () => {
    await database.query("select 1");
    return true;
  },
  listGeneratedContent: (status) => listGeneratedContent(database, status),
  listAdminAudit: (limit) => listAdminAudit(database, limit),
  listBlockedTerms: () => listBlockedTerms(database),
  listCuratedWordBank: (now) => listCuratedWordBank(database, now),
  migrateGuest: (token, identity, now) => migrateGuestToUser(database, token, identity, now),
  ...(contentProvider === "fake" ||
  contentProvider === "deterministic" ||
  contentProvider === "openai"
    ? {
        planContentJobs: (startDate: string, days: number, budgetMicros: number) =>
          planContentGenerationJobs(database, startDate, days, contentProvider, budgetMicros),
      }
    : {}),
  ...(process.env.PUBLIC_WEB_URL ? { publicWebUrl: process.env.PUBLIC_WEB_URL } : {}),
  revokeGuestSession: (token, now) => revokeGuestSession(database, token, now),
  revealCrosswordCell: (attemptId, player, cellId, clientEventId, now) =>
    player.kind === "guest"
      ? revealGuestCrosswordCell(database, attemptId, player.token, cellId, clientEventId, now)
      : revealUserCrosswordCell(database, attemptId, player.userId, cellId, clientEventId, now),
  rotateGuestSession: (token, now) => rotateGuestSession(database, token, now),
  ...(pushProvider !== "disabled" && isValidPushEncryptionKey(pushEncryptionKey)
    ? {
        registerPushEndpoint: (
          userId: string,
          token: string,
          platform: "android" | "ios",
          now: Date,
        ) => registerUserPushEndpoint(database, userId, token, platform, pushEncryptionKey, now),
      }
    : {}),
  saveProgress: (attemptId, player, version, events, now) => {
    if (isCrosswordProgressEvents(events)) {
      return player.kind === "guest"
        ? saveGuestCrosswordProgress(database, attemptId, player.token, version, events, now)
        : saveUserCrosswordProgress(database, attemptId, player.userId, version, events, now);
    }
    if (isQuizProgressEvents(events)) {
      return player.kind === "guest"
        ? saveGuestQuizProgress(database, attemptId, player.token, version, events, now)
        : saveUserQuizProgress(database, attemptId, player.userId, version, events, now);
    }
    throw new QuizAttemptError("INVALID_ANSWER", "El lote de progreso mezcla juegos");
  },
  saveQuizProgress: (attemptId, player, version, events, now) =>
    player.kind === "guest"
      ? saveGuestQuizProgress(database, attemptId, player.token, version, events, now)
      : saveUserQuizProgress(database, attemptId, player.userId, version, events, now),
  scheduleReserveEdition: (editionId, reason, correlationId, actor) =>
    scheduleReserveEdition(database, editionId, reason, correlationId, actor),
  startAttempt: async (gameId, player, now) => {
    const game = await getPublishedGame(database, gameId, now);
    if (game?.type === "crossword") {
      return player.kind === "guest"
        ? startGuestCrosswordAttempt(database, gameId, player.token, now)
        : startUserCrosswordAttempt(database, gameId, player.userId, now);
    }
    if (game?.type === "guess_word") {
      return player.kind === "guest"
        ? startGuestGuessWordAttempt(database, gameId, player.token, now)
        : startUserGuessWordAttempt(database, gameId, player.userId, now);
    }
    if (game?.type === "word_search") {
      return player.kind === "guest"
        ? startGuestWordSearchAttempt(database, gameId, player.token, now)
        : startUserWordSearchAttempt(database, gameId, player.userId, now);
    }
    return player.kind === "guest"
      ? startGuestQuizAttempt(database, gameId, player.token, now)
      : startUserQuizAttempt(database, gameId, player.userId, now);
  },
  startQuizAttempt: (gameId, player, now) =>
    player.kind === "guest"
      ? startGuestQuizAttempt(database, gameId, player.token, now)
      : startUserQuizAttempt(database, gameId, player.userId, now),
  submitQuizAttempt: (attemptId, player, now) =>
    player.kind === "guest"
      ? submitGuestQuizAttempt(database, attemptId, player.token, now)
      : submitUserQuizAttempt(database, attemptId, player.userId, now),
  submitGuessWordGuess: (attemptId, player, event, now) =>
    player.kind === "guest"
      ? recordGuestGuessWordGuess(database, attemptId, player.token, event, now)
      : recordUserGuessWordGuess(database, attemptId, player.userId, event, now),
  submitWordSearchSelection: (attemptId, player, event, now) =>
    player.kind === "guest"
      ? recordGuestWordSearchSelection(database, attemptId, player.token, event, now)
      : recordUserWordSearchSelection(database, attemptId, player.userId, event, now),
  submitAttempt: async (attemptId, player, now) => {
    const crossword = (await getAttemptGameType(database, attemptId)) === "crossword";
    if (crossword) {
      return player.kind === "guest"
        ? submitGuestCrosswordAttempt(database, attemptId, player.token, now)
        : submitUserCrosswordAttempt(database, attemptId, player.userId, now);
    }
    return player.kind === "guest"
      ? submitGuestQuizAttempt(database, attemptId, player.token, now)
      : submitUserQuizAttempt(database, attemptId, player.userId, now);
  },
  updateLeaderboardSettings: (userId, settings, now) =>
    updateUserLeaderboardSettings(database, userId, settings, now),
  updateNotificationPreferences: (userId, preferences, now) =>
    updateUserNotificationPreferences(database, userId, preferences, now),
  updatePublicationSettings: (settings, actorId, reason, correlationId, now) =>
    updatePublicationSettings(database, settings, actorId, reason, correlationId, now),
  updateConsent: (player, choice, source, now) =>
    player.kind === "guest"
      ? updateGuestConsent(database, player.token, choice, source, now)
      : updateUserConsent(database, player.userId, choice, source, now),
  reviewGeneratedContent: (contentId, decision, actorId, reason, correlationId, now) =>
    reviewGeneratedContent(database, contentId, decision, actorId, reason, correlationId, now),
  regenerateGeneratedContent: (contentId, actorId, reason, correlationId, now) =>
    regenerateGeneratedContent(database, contentId, actorId, reason, correlationId, now),
  reviseGeneratedContent: (contentId, revision, actorId, reason, correlationId, now) =>
    reviseGeneratedContent(database, contentId, revision, actorId, reason, correlationId, now),
  upsertBlockedTerm: (term, reason, actorId, correlationId, now) =>
    upsertBlockedTerm(database, term, reason, actorId, correlationId, now),
  deactivateBlockedTerm: (id, reason, actorId, correlationId, now) =>
    deactivateBlockedTerm(database, id, reason, actorId, correlationId, now),
  upsertWordBankEntry: (input, actorId, reason, correlationId, now) =>
    upsertWordBankEntry(database, input, actorId, reason, correlationId, now),
  deactivateWordBankEntry: (id, actorId, reason, correlationId, now) =>
    deactivateWordBankEntry(database, id, actorId, reason, correlationId, now),
  ...(supabaseUrl && supabasePublishableKey
    ? {
        verifyUserAccessToken: (token: string) =>
          verifySupabaseAccessToken(token, {
            publishableKey: supabasePublishableKey,
            url: supabaseUrl,
          }),
        resolveAdminAccessToken: (token: string) =>
          verifySupabaseAdminAccessToken(token, {
            publishableKey: supabasePublishableKey,
            url: supabaseUrl,
          }),
        resolveUserAccessToken: async (token: string) => {
          const identity = await verifySupabaseAccessToken(token, {
            publishableKey: supabasePublishableKey,
            url: supabaseUrl,
          });
          return identity ? getUserIdForIdentity(database, identity) : null;
        },
      }
    : {}),
});
app.addHook("onClose", () => database.close());
const port = Number(process.env.PORT ?? 4000);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

function isCrosswordProgressEvents(
  events: readonly (QuizProgressEvent | CrosswordProgressEvent)[],
): events is readonly CrosswordProgressEvent[] {
  return events.every((event) => "cellId" in event);
}

function isQuizProgressEvents(
  events: readonly (QuizProgressEvent | CrosswordProgressEvent)[],
): events is readonly QuizProgressEvent[] {
  return events.every((event) => "questionId" in event);
}
