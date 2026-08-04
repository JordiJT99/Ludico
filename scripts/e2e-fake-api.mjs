import { createServer } from "node:http";
import { URL } from "node:url";

const gameId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const crosswordGameId = "22222222-2222-4222-8222-222222222223";
const crosswordAttemptId = "33333333-3333-4333-8333-333333333334";
const historicalEditionDate = madridDateOffset(-1);
const quiz = {
  kind: "quiz",
  title: "Quiz E2E",
  questions: Array.from({ length: 5 }, (_, questionIndex) => ({
    id: `40000000-0000-4000-8000-00000000000${questionIndex}`,
    prompt: `Pregunta de prueba ${questionIndex + 1}`,
    category: "General",
    difficulty: "easy",
    options: Array.from({ length: 4 }, (_, optionIndex) => ({
      id: `50000000-0000-4000-8000-0000000000${questionIndex}${optionIndex}`,
      text: `Opción ${optionIndex + 1}`,
    })),
  })),
};
const crosswordCells = [
  crosswordCell(0, 0, 0, 1),
  crosswordCell(1, 0, 1),
  crosswordCell(2, 0, 2),
  crosswordCell(3, 1, 0),
  crosswordCell(4, 2, 0, 2),
  crosswordCell(5, 2, 1),
  crosswordCell(6, 2, 2),
];
const crossword = {
  blocks: [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
  ],
  cells: crosswordCells,
  columns: 3,
  entries: [
    {
      cellIds: crosswordCells.slice(0, 3).map(({ id }) => id),
      clue: "Astro que ilumina el día",
      direction: "across",
      id: "e0000000-0000-4000-8000-000000000001",
      number: 1,
    },
    {
      cellIds: [crosswordCells[0].id, crosswordCells[3].id, crosswordCells[4].id],
      clue: "Condimento mineral",
      direction: "down",
      id: "e0000000-0000-4000-8000-000000000002",
      number: 1,
    },
    {
      cellIds: crosswordCells.slice(4).map(({ id }) => id),
      clue: "Lo contrario de oscuridad",
      direction: "across",
      id: "e0000000-0000-4000-8000-000000000003",
      number: 2,
    },
  ],
  kind: "crossword",
  rows: 3,
  rules: { accentPolicy: "fold" },
  title: "Crucigrama E2E",
};
const crosswordSolution = new Map(
  ["S", "O", "L", "A", "L", "U", "Z"].map((value, index) => [crosswordCells[index].id, value]),
);
const crosswordPublishedSolution = {
  gameId: crosswordGameId,
  game: {
    contentVersion: 1,
    id: crosswordGameId,
    payload: crossword,
    status: "active",
    type: "crossword",
  },
  payload: {
    entries: [
      { answer: "SOL", entryId: crossword.entries[0].id },
      { answer: "SAL", entryId: crossword.entries[1].id },
      { answer: "LUZ", entryId: crossword.entries[2].id },
    ],
    kind: "crossword-solution",
  },
  publishedAt: "2026-07-29T22:00:00.000Z",
  statistics: {
    attemptCount: 20,
    averageDurationMs: 45000,
    averageScore: 1200,
    crosswordEntries: crossword.entries.map((entry, index) => ({
      entryId: entry.id,
      incorrectPercent: 20 + index * 5,
    })),
  },
};
let answers = [];
let version = 1;
let cells = [];
let crosswordVersion = 1;
let hintsUsed = 0;
let crosswordEventIds = new Set();
let unavailable = false;
let migrations = 0;
let playerAuthorization = null;
let consent = null;
let analyticsEvents = [];
let adminReviews = [];
let adminRegenerations = [];
let adminEdits = [];
let contentPlans = [];
let scheduledEditions = [];
let blockedTerms = [];
let wordBankEntries = [];
let adminCandidateStatus = "pending_review";
let adminRevision = null;
let notificationPreferences = defaultNotificationPreferences();
let pushEndpoints = [];
const port = Number(process.env.E2E_API_PORT ?? 4100);
const emptyCommandPath = /^\/v1\/(?:games\/[0-9a-f-]+\/attempts|attempts\/[0-9a-f-]+\/submit)$/i;

createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method === "POST" && path === "/__e2e/reset") {
    answers = [];
    version = 1;
    cells = [];
    crosswordVersion = 1;
    hintsUsed = 0;
    crosswordEventIds = new Set();
    unavailable = false;
    migrations = 0;
    playerAuthorization = null;
    consent = null;
    analyticsEvents = [];
    adminReviews = [];
    adminRegenerations = [];
    adminEdits = [];
    contentPlans = [];
    scheduledEditions = [];
    blockedTerms = [];
    wordBankEntries = [];
    adminCandidateStatus = "pending_review";
    adminRevision = null;
    notificationPreferences = defaultNotificationPreferences();
    pushEndpoints = [];
    return json(response, 204);
  }
  if (request.method === "GET" && path === "/__e2e/state") {
    return json(response, 200, {
      answers,
      crosswordCells: cells,
      crosswordVersion,
      hintsUsed,
      migrations,
      playerAuthorization,
      consent,
      analyticsEvents,
      adminReviews,
      adminRegenerations,
      adminEdits,
      contentPlans,
      scheduledEditions,
      blockedTerms,
      wordBankEntries,
      notificationPreferences,
      pushEndpoints,
      unavailable,
      version,
    });
  }
  if (request.method === "POST" && path === "/__e2e/unavailable") {
    const body = JSON.parse(await readBody(request));
    unavailable = body.unavailable === true;
    return json(response, 204);
  }
  if (unavailable) return json(response, 503, { code: "TEST_UNAVAILABLE" });
  if (
    request.method === "POST" &&
    emptyCommandPath.test(path) &&
    request.headers["content-type"]?.startsWith("application/json")
  ) {
    return json(response, 400, { code: "EMPTY_JSON_BODY" });
  }
  if (request.method === "POST" && path === "/auth/v1/token") {
    return json(response, 200, authSession());
  }
  if (request.method === "POST" && path === "/auth/v1/signup") {
    return json(response, 200, authSession());
  }
  if (request.method === "GET" && path === "/auth/v1/user") {
    return request.headers.authorization === "Bearer e2e-access-token"
      ? json(response, 200, { email: "cuenta@example.com", id: "e2e-user" })
      : json(response, 401, { code: "INVALID_TOKEN" });
  }
  if (request.method === "POST" && path === "/auth/v1/logout") {
    return json(response, 204);
  }
  if (request.method === "POST" && path === "/v1/auth/migrate-guest") {
    if (
      request.headers.authorization !== "Bearer e2e-access-token" ||
      typeof request.headers["x-guest-token"] !== "string"
    ) {
      return json(response, 401, { code: "UNAUTHORIZED" });
    }
    migrations += 1;
    return json(response, 200, {
      migratedAttempts: answers.length || cells.length ? 1 : 0,
      userId: "77777777-7777-4777-8777-777777777777",
    });
  }
  if (request.method === "GET" && path === "/v1/editions/today") {
    return json(response, 200, {
      id: "11111111-1111-4111-8111-111111111111",
      localDate: madridDateOffset(0),
      opensAt: `${historicalEditionDate}T22:00:00.000Z`,
      closesAt: `${madridDateOffset(0)}T22:00:00.000Z`,
      games: [
        { id: gameId, type: "quiz", status: "active", payload: quiz, contentVersion: 1 },
        {
          id: crosswordGameId,
          type: "crossword",
          status: "active",
          payload: crossword,
          contentVersion: 1,
        },
      ],
    });
  }
  if (request.method === "GET" && path === `/v1/editions/${historicalEditionDate}`) {
    return json(response, 200, {
      id: "11111111-1111-4111-8111-111111111110",
      localDate: historicalEditionDate,
      opensAt: `${madridDateOffset(-2)}T22:00:00.000Z`,
      closesAt: `${historicalEditionDate}T22:00:00.000Z`,
      games: [
        {
          id: crosswordGameId,
          type: "crossword",
          status: "active",
          payload: crossword,
          contentVersion: 1,
        },
      ],
    });
  }
  if (request.method === "POST" && path === "/v1/guest-sessions") {
    return json(response, 201, {
      expiresAt: "2026-08-28T08:00:00.000Z",
      guestSessionId: "66666666-6666-4666-8666-666666666666",
      token: "a".repeat(43),
    });
  }
  if (
    path.startsWith("/v1/admin/") &&
    request.headers.authorization !== "Bearer e2e-access-token"
  ) {
    return json(response, 401, { code: "UNAUTHORIZED" });
  }
  if (request.method === "GET" && path === "/v1/admin/editions/calendar") {
    return json(response, 200, {
      editions: [
        {
          gameCount: 2,
          id: "11111111-1111-4111-8111-111111111111",
          localDate: "2026-07-29",
          status: "published",
        },
        {
          gameCount: 2,
          id: "55555555-5555-4555-8555-555555555555",
          localDate: "2026-07-30",
          status: scheduledEditions.some(
            (edition) => edition.id === "55555555-5555-4555-8555-555555555555",
          )
            ? "scheduled"
            : "approved",
        },
      ],
      reserve: { crossword: 8, quiz: 9, true_false: 8, guess_word: 8, word_search: 8 },
    });
  }
  if (request.method === "POST" && /^\/v1\/admin\/editions\/[0-9a-f-]+\/schedule$/i.test(path)) {
    const id = path.split("/")[4];
    scheduledEditions.push({ id, ...JSON.parse(await readBody(request)) });
    return json(response, 200, { changed: true, status: "scheduled" });
  }
  if (request.method === "GET" && path === "/v1/admin/analytics/dashboard") {
    return json(response, 200, {
      daily: [{ activeSubjects: 12, completions: 7, localDate: "2026-07-29", starts: 10 }],
      definitions: {
        activeSubjects: "Sujetos seudónimos únicos con AppOpened en el periodo.",
        completionRate: "Intentos únicos completados / intentos únicos iniciados.",
      },
      freshness: "2026-07-29T10:00:00.000Z",
      generatedAt: "2026-07-29T12:00:00.000Z",
      owner: "Product/Data",
      period: { days: 7, from: "2026-07-23", to: "2026-07-29" },
      totals: {
        activeSubjects: 12,
        completionRate: 70,
        completions: 7,
        quarantinedBatches: 1,
        registrations: 2,
        shares: 3,
        starts: 10,
      },
    });
  }
  if (request.method === "GET" && path === "/v1/admin/audit") {
    return json(response, 200, [
      {
        action: "schedule",
        actorId: "editor-e2e",
        actorType: "admin",
        correlationId: "audit-e2e-1",
        id: "44444444-4444-4444-8444-444444444444",
        occurredAt: "2026-07-29T10:00:00.000Z",
        reason: "Reserva completa revisada",
        targetId: "55555555-5555-4555-8555-555555555555",
        targetType: "DailyEdition",
      },
    ]);
  }
  if (request.method === "GET" && path === "/v1/admin/content") {
    return json(response, 200, [
      {
        contentType: "quiz",
        findings: [{ code: "HIGH_RISK_REVIEW" }],
        id: "88888888-8888-4888-8888-888888888888",
        privatePayload: adminRevision?.privatePayload ?? {
          kind: "quiz-solution",
          questions: quiz.questions.map((question) => ({
            correctOptionId: question.options[0].id,
            explanation: "Explicación privada de prueba",
            questionId: question.id,
          })),
        },
        publicPayload: adminRevision?.publicPayload ?? quiz,
        sources:
          adminRevision?.sources ??
          quiz.questions.map((question) => ({
            itemId: question.id,
            url: `https://example.com/${question.id}`,
          })),
        status: adminCandidateStatus,
        targetDate: "2026-07-31",
      },
    ]);
  }
  if (request.method === "GET" && path === "/v1/admin/blocked-terms") {
    return json(response, 200, blockedTerms);
  }
  if (request.method === "POST" && path === "/v1/admin/blocked-terms") {
    const body = JSON.parse(await readBody(request));
    const normalizedTerm = body.term.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const existing = blockedTerms.find((item) => item.normalizedTerm === normalizedTerm);
    const record = {
      active: true,
      id: existing?.id ?? "77777777-7777-4777-8777-777777777777",
      normalizedTerm,
      reason: body.reason,
    };
    blockedTerms = [...blockedTerms.filter((item) => item.id !== record.id), record];
    return json(response, 200, record);
  }
  if (
    request.method === "POST" &&
    /^\/v1\/admin\/blocked-terms\/[0-9a-f-]+\/deactivate$/i.test(path)
  ) {
    const id = path.split("/")[4];
    blockedTerms = blockedTerms.map((item) => (item.id === id ? { ...item, active: false } : item));
    return json(response, 200, { active: false, changed: true, id });
  }
  if (request.method === "GET" && path === "/v1/admin/word-bank") {
    return json(
      response,
      200,
      wordBankEntries.filter((entry) => entry.active),
    );
  }
  if (request.method === "POST" && path === "/v1/admin/word-bank") {
    const body = JSON.parse(await readBody(request));
    const record = {
      active: true,
      answer: body.answer.trim().toUpperCase(),
      category: body.category,
      clue: body.clue,
      difficulty: body.difficulty,
      id: "66666666-6666-4666-8666-666666666665",
      letterCount: Array.from(body.answer.trim()).length,
      locale: "es-ES",
      qualityScore: body.qualityScore,
      sourceCheckedAt: body.sourceCheckedAt,
      sourceUrl: body.sourceUrl,
      validationStatus: body.validationStatus,
      variants: body.variants,
    };
    wordBankEntries = [record];
    return json(response, 200, record);
  }
  if (request.method === "POST" && /^\/v1\/admin\/word-bank\/[0-9a-f-]+\/deactivate$/i.test(path)) {
    const id = path.split("/")[4];
    wordBankEntries = wordBankEntries.map((entry) =>
      entry.id === id ? { ...entry, active: false } : entry,
    );
    return json(response, 200, { active: false, changed: true, id });
  }
  if (request.method === "POST" && path === "/v1/admin/content/plan") {
    contentPlans.push(JSON.parse(await readBody(request)));
    return json(response, 200, []);
  }
  if (request.method === "PATCH" && /^\/v1\/admin\/content\/[0-9a-f-]+$/i.test(path)) {
    const body = JSON.parse(await readBody(request));
    adminRevision = body;
    adminEdits.push(body);
    adminCandidateStatus = "pending_review";
    return json(response, 200, {
      contentType: "quiz",
      findings: [],
      id: "88888888-8888-4888-8888-888888888888",
      privatePayload: body.privatePayload,
      publicPayload: body.publicPayload,
      sources: body.sources,
      status: adminCandidateStatus,
      targetDate: "2026-07-31",
    });
  }
  if (
    request.method === "POST" &&
    /^\/v1\/admin\/content\/[0-9a-f-]+\/(approve|regenerate|reject)$/i.test(path)
  ) {
    if (path.endsWith("/regenerate")) {
      adminRegenerations.push(JSON.parse(await readBody(request)));
      adminCandidateStatus = "rejected";
      return json(response, 200, {
        changed: true,
        jobId: "99999999-9999-4999-8999-999999999999",
        status: "queued",
      });
    }
    const decision = path.endsWith("/approve") ? "approved" : "rejected";
    adminReviews.push({ decision, ...JSON.parse(await readBody(request)) });
    adminCandidateStatus = decision;
    return json(response, 200, { changed: true, status: decision });
  }
  if (request.method === "GET" && path === "/v1/consents/current") {
    return json(
      response,
      200,
      consent ?? {
        ads: false,
        analytics: false,
        policyVersion: "2026-07-01",
        recordedAt: null,
      },
    );
  }
  if (request.method === "POST" && path === "/v1/consents") {
    consent = {
      ...JSON.parse(await readBody(request)),
      recordedAt: new Date().toISOString(),
    };
    return json(response, 200, consent);
  }
  if (request.method === "POST" && path === "/v1/analytics/events") {
    if (!consent?.analytics) return json(response, 200, { accepted: 0 });
    const body = JSON.parse(await readBody(request));
    const fresh = body.events.filter(
      (event) => !analyticsEvents.some((stored) => stored.eventId === event.eventId),
    );
    analyticsEvents.push(...fresh);
    return json(response, 200, { accepted: fresh.length });
  }
  if (request.method === "GET" && path === "/v1/me/streaks") {
    return json(response, 200, { best: 4, current: 2, lastCompletedDate: "2026-07-29" });
  }
  if (request.method === "GET" && path === "/v1/me/previous-results") {
    if (request.headers.authorization !== "Bearer e2e-access-token") {
      return json(response, 401, { code: "ACCOUNT_REQUIRED" });
    }
    return json(response, 200, [
      {
        attemptId: crosswordAttemptId,
        competitive: false,
        gameId: crosswordGameId,
        gameType: "crossword",
        localDate: "2026-07-28",
        points: 1250,
      },
    ]);
  }
  if (request.method === "GET" && path === "/v1/me/data-export") {
    if (request.headers.authorization !== "Bearer e2e-access-token") {
      return json(response, 401, { code: "ACCOUNT_REQUIRED" });
    }
    response.setHeader("Content-Disposition", 'attachment; filename="ludico-datos.json"');
    response.setHeader("Cache-Control", "private, no-store");
    return json(response, 200, {
      analyticsEvents: [],
      attempts: [],
      consents: [],
      crosswordCells: [],
      generatedAt: "2026-07-29T12:00:00.000Z",
      notificationPreferences,
      profile: {
        alias: null,
        createdAt: "2026-07-20T12:00:00.000Z",
        email: "cuenta@example.com",
        leaderboardOptIn: false,
      },
      quizAnswers: [],
    });
  }
  if (request.method === "DELETE" && path === "/v1/me") {
    if (request.headers.authorization !== "Bearer e2e-access-token") {
      return json(response, 401, { code: "ACCOUNT_REQUIRED" });
    }
    const body = JSON.parse(await readBody(request));
    return body.confirmation === "ELIMINAR"
      ? json(response, 200, { deleted: true })
      : json(response, 400, { code: "INVALID_REQUEST" });
  }
  if (request.method === "GET" && path === "/v1/me/leaderboard-settings") {
    return json(response, 200, { alias: null, leaderboardOptIn: false });
  }
  if (request.method === "PATCH" && path === "/v1/me/leaderboard-settings") {
    return json(response, 200, JSON.parse(await readBody(request)));
  }
  if (request.method === "GET" && path === "/v1/me/notification-preferences") {
    return json(response, 200, notificationPreferences);
  }
  if (request.method === "PATCH" && path === "/v1/me/notification-preferences") {
    notificationPreferences = JSON.parse(await readBody(request));
    return json(response, 200, notificationPreferences);
  }
  if (request.method === "POST" && path === "/v1/devices/push-token") {
    const endpoint = { endpointId: "99999999-9999-4999-8999-999999999999" };
    pushEndpoints.push(JSON.parse(await readBody(request)));
    return json(response, 200, endpoint);
  }
  if (request.method === "GET" && path === `/v1/games/${gameId}`) {
    return json(response, 200, {
      id: gameId,
      type: "quiz",
      status: "active",
      payload: quiz,
      contentVersion: 1,
    });
  }
  if (request.method === "GET" && path === `/v1/games/${gameId}/solution`) {
    return json(response, 423, { code: "SOLUTION_LOCKED" });
  }
  if (request.method === "GET" && path === `/v1/games/${crosswordGameId}`) {
    return json(response, 200, {
      id: crosswordGameId,
      type: "crossword",
      status: "active",
      payload: crossword,
      contentVersion: 1,
    });
  }
  if (request.method === "GET" && path === `/v1/games/${crosswordGameId}/solution`) {
    return json(response, 200, crosswordPublishedSolution);
  }
  if (request.method === "GET" && path === `/v1/attempts/${crosswordAttemptId}/review`) {
    return json(response, 200, {
      attemptId: crosswordAttemptId,
      progress: { cells, hintsUsed, kind: "crossword-progress" },
      score: {
        competitive: hintsUsed === 0,
        points: hintsUsed ? 1_250 : 1_350,
        scoreVersion: "crossword-v1",
      },
      solution: crosswordPublishedSolution,
      submittedAt: "2026-07-29T21:00:00.000Z",
    });
  }
  if (request.method === "GET" && path === `/v1/leaderboards/game/${gameId}`) {
    return json(response, 200, {
      entries: [{ alias: "Ana", durationMs: 20_000, points: 900, rank: 1 }],
      key: gameId,
      own: { durationMs: 30_000, percentile: 50, points: 800, rank: 2, total: 2 },
      scope: "game",
    });
  }
  if (request.method === "GET" && path === `/v1/leaderboards/game/${crosswordGameId}`) {
    return json(response, 200, {
      entries: [{ alias: "Ana", durationMs: 20_000, points: 1_350, rank: 1 }],
      key: crosswordGameId,
      own: {
        durationMs: 30_000,
        percentile: 50,
        points: hintsUsed ? 1_250 : 1_350,
        rank: 2,
        total: 2,
      },
      scope: "game",
    });
  }
  if (request.method === "POST" && path === "/v1/share-results") {
    const body = JSON.parse(await readBody(request));
    const crosswordAttempt = body.attemptId === crosswordAttemptId;
    return json(response, 200, {
      text: `Lúdico · ${crosswordAttempt ? "Crucigrama diario" : "Quiz diario"}\n${crosswordAttempt ? (hintsUsed ? 1_250 : 1_350) : 800} puntos · ${crosswordAttempt && hintsUsed ? "Partida casual" : "Clasificación"}`,
      url: `http://127.0.0.1:3100/resultados/${crosswordAttempt ? crosswordGameId : gameId}`,
    });
  }
  if (request.method === "POST" && path === `/v1/games/${gameId}/attempts`) {
    playerAuthorization = request.headers.authorization ?? null;
    return json(response, 200, { answers, attemptId, status: "in_progress", version });
  }
  if (request.method === "POST" && path === `/v1/games/${crosswordGameId}/attempts`) {
    return json(response, 200, {
      attemptId: crosswordAttemptId,
      cells,
      hintsUsed,
      status: "in_progress",
      version: crosswordVersion,
    });
  }
  if (request.method === "PUT" && path === `/v1/attempts/${attemptId}/progress`) {
    const body = JSON.parse(await readBody(request));
    if (body.version !== version) {
      return json(response, 409, {
        code: "VERSION_CONFLICT",
        state: { answers, attemptId, status: "in_progress", version },
      });
    }
    for (const event of body.events) {
      answers = [
        ...answers.filter((answer) => answer.questionId !== event.questionId),
        {
          elapsedMs: event.elapsedMs,
          questionId: event.questionId,
          selectedOptionId: event.selectedOptionId,
        },
      ];
    }
    version += 1;
    return json(response, 200, { savedEvents: body.events.length, status: "saved", version });
  }
  if (request.method === "POST" && path === `/v1/attempts/${attemptId}/submit`) {
    return json(response, 202, {
      attemptId,
      competitive: true,
      provisional: { completed: answers.length === quiz.questions.length, score: 800 },
      solutionAvailableAt: "2026-07-29T22:00:00.000Z",
      status: "accepted",
    });
  }
  if (request.method === "PUT" && path === `/v1/attempts/${crosswordAttemptId}/progress`) {
    const body = JSON.parse(await readBody(request));
    if (body.version !== crosswordVersion) {
      return json(response, 409, {
        code: "VERSION_CONFLICT",
        state: {
          attemptId: crosswordAttemptId,
          cells,
          hintsUsed,
          status: "in_progress",
          version: crosswordVersion,
        },
      });
    }
    let savedEvents = 0;
    for (const event of body.events) {
      if (crosswordEventIds.has(event.clientEventId)) continue;
      crosswordEventIds.add(event.clientEventId);
      cells = cells.filter((cell) => cell.cellId !== event.cellId);
      if (event.value) {
        cells.push({ cellId: event.cellId, elapsedMs: event.elapsedMs, value: event.value });
      }
      savedEvents += 1;
    }
    if (savedEvents) crosswordVersion += 1;
    return json(response, 200, {
      savedEvents,
      status: "saved",
      version: crosswordVersion,
    });
  }
  if (request.method === "POST" && path === `/v1/attempts/${crosswordAttemptId}/hints`) {
    const body = JSON.parse(await readBody(request));
    const value = crosswordSolution.get(body.cellId);
    if (!value) return json(response, 422, { code: "INVALID_CELL" });
    if (!cells.some((cell) => cell.cellId === body.cellId && cell.elapsedMs === 0)) {
      hintsUsed += 1;
      crosswordVersion += 1;
    }
    cells = [
      ...cells.filter((cell) => cell.cellId !== body.cellId),
      { cellId: body.cellId, elapsedMs: 0, value },
    ];
    return json(response, 200, {
      attemptId: crosswordAttemptId,
      cellId: body.cellId,
      competitive: false,
      hintsUsed,
      value,
      version: crosswordVersion,
    });
  }
  if (request.method === "POST" && path === `/v1/attempts/${crosswordAttemptId}/submit`) {
    return json(response, 202, {
      attemptId: crosswordAttemptId,
      competitive: hintsUsed === 0,
      provisional: {
        completed: cells.length === crossword.cells.length,
        score: hintsUsed ? 1_250 : 1_350,
      },
      solutionAvailableAt: "2026-07-29T22:00:00.000Z",
      status: "accepted",
    });
  }
  return json(response, 404, { code: "NOT_FOUND" });
}).listen(port, "127.0.0.1", () => console.log(`E2E API: http://127.0.0.1:${port}`));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function crosswordCell(index, row, column, number) {
  return {
    column,
    id: `a0000000-0000-4000-8000-00000000000${index}`,
    ...(number ? { number } : {}),
    row,
  };
}

function authSession() {
  return {
    access_token: "e2e-access-token",
    expires_in: 3_600,
    refresh_token: "e2e-refresh-token",
    user: { email: "cuenta@example.com", id: "e2e-user" },
  };
}

function defaultNotificationPreferences() {
  return {
    editionAvailable: true,
    enabled: false,
    previousSolution: true,
    quietEnd: "08:00",
    quietStart: "22:00",
    timeZone: "Europe/Madrid",
  };
}

function madridDateOffset(offset) {
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}
