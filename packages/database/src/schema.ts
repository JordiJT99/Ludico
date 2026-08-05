import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  version: integer("version").default(1).notNull(),
};

export const publicationSettings = pgTable(
  "publication_settings",
  {
    market: text("market").primaryKey(),
    opensAtLocalTime: text("opens_at_local_time").default("00:00").notNull(),
    closesAtLocalTime: text("closes_at_local_time").default("00:00").notNull(),
    contentPlanLocalTime: text("content_plan_local_time").default("02:00").notNull(),
    reserveDays: integer("reserve_days").default(14).notNull(),
    ...auditColumns,
  },
  (table) => [
    check("publication_settings_market_check", sql`${table.market} = 'ES'`),
    check("publication_settings_reserve_check", sql`${table.reserveDays} between 7 and 21`),
  ],
);

export const dailyEditions = pgTable(
  "daily_editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    market: text("market").default("ES").notNull(),
    localDate: date("local_date").notNull(),
    marketTimeZone: text("market_time_zone").default("Europe/Madrid").notNull(),
    status: text("status").default("draft").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("daily_editions_market_date_active_uidx")
      .on(table.market, table.localDate)
      .where(sql`${table.status} <> 'cancelled'`),
    index("daily_editions_status_opens_idx").on(table.status, table.opensAt),
    check(
      "daily_editions_status_check",
      sql`${table.status} in ('draft','validating','approved','scheduled','published','closed','archived','rejected','cancelled')`,
    ),
    check("daily_editions_window_check", sql`${table.closesAt} > ${table.opensAt}`),
  ],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    editionId: uuid("edition_id")
      .references(() => dailyEditions.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    status: text("status").default("active").notNull(),
    publicPayload: jsonb("public_payload").notNull(),
    contentVersion: integer("content_version").default(1).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("games_edition_type_uidx").on(table.editionId, table.type),
    check(
      "games_type_check",
      sql`${table.type} in ('quiz','crossword','true_false','guess_word','word_search')`,
    ),
    check("games_status_check", sql`${table.status} in ('active','disabled')`),
  ],
);

export const gameSolutions = pgTable("game_solutions", {
  gameId: uuid("game_id")
    .primaryKey()
    .references(() => games.id, { onDelete: "cascade" }),
  privatePayload: jsonb("private_payload").notNull(),
  publicPayload: jsonb("public_payload"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...auditColumns,
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authProvider: text("auth_provider").notNull(),
    externalSubject: text("external_subject").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    publicAlias: text("public_alias"),
    leaderboardOptIn: boolean("leaderboard_opt_in").default(false).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("users_provider_subject_uidx").on(table.authProvider, table.externalSubject),
    uniqueIndex("users_email_active_uidx")
      .on(table.emailNormalized)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").default("active").notNull(),
    origin: text("origin").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    previousSessionId: uuid("previous_session_id").references((): AnyPgColumn => guestSessions.id, {
      onDelete: "set null",
    }),
    migratedUserId: uuid("migrated_user_id").references(() => users.id, { onDelete: "set null" }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("guest_sessions_token_hash_uidx").on(table.tokenHash),
    index("guest_sessions_status_expiry_idx").on(table.status, table.expiresAt),
    check(
      "guest_sessions_status_check",
      sql`${table.status} in ('active','rotated','expired','migrated','revoked')`,
    ),
    check("guest_sessions_origin_check", sql`${table.origin} in ('web','android','ios')`),
  ],
);

export const gameAttempts = pgTable(
  "game_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .references(() => games.id, { onDelete: "cascade" })
      .notNull(),
    guestSessionId: uuid("guest_session_id").references(() => guestSessions.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").default("in_progress").notNull(),
    mode: text("mode").default("competitive").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    serverReceivedAt: timestamp("server_received_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("attempts_guest_game_competitive_uidx")
      .on(table.gameId, table.guestSessionId)
      .where(sql`${table.mode} = 'competitive' and ${table.guestSessionId} is not null`),
    uniqueIndex("attempts_user_game_competitive_uidx")
      .on(table.gameId, table.userId)
      .where(sql`${table.mode} = 'competitive' and ${table.userId} is not null`),
    index("attempts_status_started_idx").on(table.status, table.startedAt),
    check(
      "attempts_subject_xor_check",
      sql`(${table.guestSessionId} is not null) <> (${table.userId} is not null)`,
    ),
    check(
      "attempts_status_check",
      sql`${table.status} in ('in_progress','submitted','accepted','rejected','finalized')`,
    ),
    check("attempts_mode_check", sql`${table.mode} in ('competitive','casual')`),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    questionId: uuid("question_id").notNull(),
    selectedOptionId: uuid("selected_option_id").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("answers_attempt_question_uidx").on(table.attemptId, table.questionId),
    check("answers_elapsed_check", sql`${table.elapsedMs} >= 0 and ${table.elapsedMs} <= 3600000`),
  ],
);

export const crosswordCells = pgTable(
  "crossword_cells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    cellId: uuid("cell_id").notNull(),
    value: text("value").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("crossword_cells_attempt_cell_uidx").on(table.attemptId, table.cellId),
    check(
      "crossword_cells_value_check",
      sql`char_length(${table.value}) >= 1 and char_length(${table.value}) <= 2`,
    ),
    check(
      "crossword_cells_elapsed_check",
      sql`${table.elapsedMs} >= 0 and ${table.elapsedMs} <= 3600000`,
    ),
  ],
);

export const wordGuesses = pgTable(
  "word_guesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    guess: text("guess").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    ...auditColumns,
  },
  (table) => [
    index("word_guesses_attempt_created_idx").on(table.attemptId, table.createdAt),
    check(
      "word_guesses_guess_check",
      sql`char_length(${table.guess}) >= 1 and char_length(${table.guess}) <= 21`,
    ),
    check(
      "word_guesses_elapsed_check",
      sql`${table.elapsedMs} >= 0 and ${table.elapsedMs} <= 3600000`,
    ),
  ],
);

export const wordSearchFinds = pgTable(
  "word_search_finds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    entryId: uuid("entry_id").notNull(),
    elapsedMs: integer("elapsed_ms").notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("word_search_finds_attempt_entry_uidx").on(table.attemptId, table.entryId),
    check(
      "word_search_finds_elapsed_check",
      sql`${table.elapsedMs} >= 0 and ${table.elapsedMs} <= 3600000`,
    ),
  ],
);

export const attemptEvents = pgTable(
  "attempt_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    clientEventId: uuid("client_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    clientOccurredAt: timestamp("client_occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attempt_events_client_uidx").on(table.attemptId, table.clientEventId),
    index("attempt_events_received_idx").on(table.attemptId, table.receivedAt),
    check(
      "attempt_events_type_check",
      sql`${table.eventType} in ('answer_selected','cell_set','hint_revealed','word_guessed','word_found')`,
    ),
  ],
);

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .references(() => gameAttempts.id, { onDelete: "cascade" })
      .notNull(),
    points: integer("points").notNull(),
    scoreVersion: text("score_version").notNull(),
    competitive: boolean("competitive").notNull(),
    durationMs: integer("duration_ms").default(0).notNull(),
    breakdown: jsonb("breakdown").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("scores_attempt_uidx").on(table.attemptId),
    check("scores_points_check", sql`${table.points} >= 0`),
    check("scores_duration_check", sql`${table.durationMs} >= 0`),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guestSessionId: uuid("guest_session_id"),
    userId: uuid("user_id"),
    policyVersion: text("policy_version").notNull(),
    analytics: boolean("analytics").notNull(),
    ads: boolean("ads").notNull(),
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("consents_guest_recorded_idx").on(table.guestSessionId, table.recordedAt),
    index("consents_user_recorded_idx").on(table.userId, table.recordedAt),
    check(
      "consents_subject_xor_check",
      sql`(${table.guestSessionId} is not null) <> (${table.userId} is not null)`,
    ),
    check("consents_source_check", sql`${table.source} in ('web','android','ios')`),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    eventId: uuid("event_id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    eventName: text("event_name").notNull(),
    eventVersion: integer("event_version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    properties: jsonb("properties").notNull(),
    consentPolicyVersion: text("consent_policy_version").notNull(),
  },
  (table) => [
    index("analytics_name_received_idx").on(table.eventName, table.receivedAt),
    check("analytics_subject_type_check", sql`${table.subjectType} in ('guest','user')`),
    check("analytics_event_version_check", sql`${table.eventVersion} >= 1`),
  ],
);

export const analyticsEventQuarantine = pgTable(
  "analytics_event_quarantine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type").notNull(),
    eventCount: integer("event_count").notNull(),
    reason: text("reason").notNull(),
    structuralFingerprint: text("structural_fingerprint").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analytics_quarantine_received_idx").on(table.receivedAt),
    check("analytics_quarantine_subject_check", sql`${table.subjectType} in ('guest','user')`),
    check("analytics_quarantine_event_count_check", sql`${table.eventCount} between 1 and 100`),
    check("analytics_quarantine_reason_check", sql`${table.reason} in ('INVALID_ANALYTICS_EVENT')`),
  ],
);

export const contentGenerationJobs = pgTable(
  "content_generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentType: text("content_type").notNull(),
    targetDate: date("target_date").notNull(),
    status: text("status").default("queued").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version").default("v1").notNull(),
    config: jsonb("config").default({}).notNull(),
    budgetMicros: integer("budget_micros").default(0).notNull(),
    costMicros: integer("cost_micros").default(0).notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("content_jobs_type_date_uidx").on(table.contentType, table.targetDate),
    index("content_jobs_status_target_idx").on(table.status, table.targetDate),
    check(
      "content_jobs_type_check",
      sql`${table.contentType} in ('quiz','crossword','true_false','guess_word','word_search')`,
    ),
    check(
      "content_jobs_status_check",
      sql`${table.status} in ('queued','running','succeeded','failed')`,
    ),
    check("content_jobs_cost_check", sql`${table.budgetMicros} >= 0 and ${table.costMicros} >= 0`),
  ],
);

export const generatedContents = pgTable(
  "generated_contents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationJobId: uuid("generation_job_id")
      .references(() => contentGenerationJobs.id)
      .notNull(),
    contentType: text("content_type").notNull(),
    targetDate: date("target_date").notNull(),
    status: text("status").notNull(),
    publicPayload: jsonb("public_payload").notNull(),
    privatePayload: jsonb("private_payload").notNull(),
    sources: jsonb("sources").notNull(),
    contentHash: text("content_hash").notNull(),
    findings: jsonb("findings").default([]).notNull(),
    qualityScore: integer("quality_score").default(0).notNull(),
    selectedEditionId: uuid("selected_edition_id").references(() => dailyEditions.id, {
      onDelete: "set null",
    }),
    ...auditColumns,
  },
  (table) => [
    index("generated_content_status_target_idx").on(
      table.status,
      table.targetDate,
      table.contentType,
    ),
    index("generated_content_hash_idx").on(table.contentHash),
    check("generated_content_quality_check", sql`${table.qualityScore} between 0 and 100`),
    check(
      "generated_content_type_check",
      sql`${table.contentType} in ('quiz','crossword','true_false','guess_word','word_search')`,
    ),
    check(
      "generated_content_status_check",
      sql`${table.status} in ('approved','pending_review','rejected','selected')`,
    ),
  ],
);

export const validationResults = pgTable(
  "validation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generatedContentId: uuid("generated_content_id")
      .references(() => generatedContents.id, { onDelete: "cascade" })
      .notNull(),
    validator: text("validator").notNull(),
    validatorVersion: text("validator_version").notNull(),
    outcome: text("outcome").notNull(),
    details: jsonb("details").default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("validation_content_validator_uidx").on(
      table.generatedContentId,
      table.validator,
      table.validatorVersion,
    ),
    check("validation_outcome_check", sql`${table.outcome} in ('passed','review','failed')`),
  ],
);

export const blockedTerms = pgTable(
  "blocked_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    normalizedTerm: text("normalized_term").notNull(),
    reason: text("reason").notNull(),
    active: boolean("active").default(true).notNull(),
    ...auditColumns,
  },
  (table) => [uniqueIndex("blocked_terms_normalized_uidx").on(table.normalizedTerm)],
);

export const wordBankEntries = pgTable(
  "word_bank_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locale: text("locale").default("es-ES").notNull(),
    answer: text("answer").notNull(),
    normalizedAnswer: text("normalized_answer").notNull(),
    clue: text("clue").notNull(),
    clueHash: text("clue_hash").notNull(),
    category: text("category").notNull(),
    difficulty: integer("difficulty").notNull(),
    letterCount: integer("letter_count").notNull(),
    variants: jsonb("variants").default([]).notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceCheckedAt: timestamp("source_checked_at", { withTimezone: true }).notNull(),
    validationStatus: text("validation_status").notNull(),
    qualityScore: integer("quality_score").notNull(),
    active: boolean("active").default(true).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("word_bank_active_answer_clue_uidx")
      .on(table.locale, table.normalizedAnswer, table.clueHash)
      .where(sql`${table.active} = true`),
    index("word_bank_locale_quality_idx").on(table.locale, table.active, table.qualityScore),
    check(
      "word_bank_answer_length_check",
      sql`char_length(${table.normalizedAnswer}) between 2 and 21`,
    ),
    check("word_bank_quality_check", sql`${table.qualityScore} between 0 and 100`),
    check("word_bank_difficulty_check", sql`${table.difficulty} between 1 and 5`),
    check("word_bank_letter_count_check", sql`${table.letterCount} between 2 and 21`),
    check(
      "word_bank_validation_status_check",
      sql`${table.validationStatus} in ('pending','approved','rejected')`,
    ),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    editionAvailable: boolean("edition_available").default(true).notNull(),
    previousSolution: boolean("previous_solution").default(true).notNull(),
    timeZone: text("time_zone").default("Europe/Madrid").notNull(),
    quietStart: text("quiet_start").default("22:00").notNull(),
    quietEnd: text("quiet_end").default("08:00").notNull(),
    ...auditColumns,
  },
  (table) => [
    check(
      "notification_quiet_start_check",
      sql`${table.quietStart} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "notification_quiet_end_check",
      sql`${table.quietEnd} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

export const notificationEndpoints = pgTable(
  "notification_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").default("expo").notNull(),
    platform: text("platform").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    active: boolean("active").default(true).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("notification_endpoints_token_hash_uidx").on(table.tokenHash),
    index("notification_endpoints_user_active_idx").on(table.userId, table.active),
    check("notification_endpoint_provider_check", sql`${table.provider} in ('expo')`),
    check("notification_endpoint_platform_check", sql`${table.platform} in ('android','ios')`),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    endpointId: uuid("endpoint_id").references(() => notificationEndpoints.id, {
      onDelete: "set null",
    }),
    editionId: uuid("edition_id").notNull(),
    useCase: text("use_case").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").default("queued").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deepLink: text("deep_link").notNull(),
    providerMessageId: text("provider_message_id"),
    errorCode: text("error_code"),
    attempts: integer("attempts").default(0).notNull(),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex("notification_deliveries_dedupe_uidx").on(table.dedupeKey),
    index("notification_deliveries_due_idx").on(table.status, table.scheduledAt),
    index("notification_deliveries_user_scheduled_idx").on(table.userId, table.scheduledAt),
    check(
      "notification_delivery_use_case_check",
      sql`${table.useCase} in ('daily_digest','edition_available','previous_solution')`,
    ),
    check(
      "notification_delivery_status_check",
      sql`${table.status} in ('queued','sending','sent','failed','cancelled')`,
    ),
    check("notification_delivery_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("idempotency_scope_key_uidx").on(table.scope, table.key)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
  },
  (table) => [index("outbox_unpublished_idx").on(table.publishedAt, table.occurredAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    correlationId: text("correlation_id").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_target_idx").on(table.targetType, table.targetId, table.occurredAt)],
);
