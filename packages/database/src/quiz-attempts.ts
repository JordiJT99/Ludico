import type {
  PublicGame,
  QuizAttemptAnswer,
  QuizAttemptState,
  QuizProgressEvent,
  QuizPublicPayload,
  QuizSubmitResult,
} from "@ludico/contracts";
import {
  calculateQuizScore,
  type QuizPrivateSolution,
  type QuizValidationOptions,
  validateQuiz,
} from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

interface GameRow extends QueryResultRow {
  closesAt: Date | string;
  contentVersion: number;
  id: string;
  privatePayload: QuizPrivateSolution;
  publicPayload: QuizPublicPayload;
  status: "active" | "disabled";
  type: "quiz" | "true_false";
}

interface PublicGameRow extends QueryResultRow {
  contentVersion: number;
  id: string;
  publicPayload: object;
  status: "active" | "disabled";
  type: "quiz" | "crossword" | "true_false";
}

interface AttemptRow extends QueryResultRow {
  closesAt: Date | string;
  gameId: string;
  guestSessionId: string | null;
  id: string;
  mode: "competitive" | "casual";
  privatePayload: QuizPrivateSolution;
  publicPayload: QuizPublicPayload;
  startedAt: Date | string;
  status: string;
  type: "quiz" | "true_false";
  userId: string | null;
  version: number;
}

type AttemptSubject = { kind: "guest"; id: string } | { kind: "user"; id: string };

interface ScoreRow extends QueryResultRow {
  competitive: boolean;
  completed: boolean;
  points: number;
}

export type QuizAttemptErrorCode =
  | "ATTEMPT_NOT_EDITABLE"
  | "ATTEMPT_NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "INVALID_ANSWER"
  | "UNAUTHORIZED";

export class QuizAttemptError extends Error {
  constructor(
    readonly code: QuizAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QuizAttemptError";
  }
}

export type QuizProgressResult =
  | { status: "saved"; savedEvents: number; version: number }
  | { status: "conflict"; state: QuizAttemptState };

export async function getPublishedGame(
  client: TransactionClient,
  gameId: string,
  now: Date,
): Promise<PublicGame | null> {
  const result = await client.query<PublicGameRow>(
    `select game.id, game.type, game.status, game.public_payload as "publicPayload",
            game.content_version as "contentVersion"
     from games game
     join daily_editions edition on edition.id = game.edition_id
     where game.id = $1 and game.status = 'active' and edition.status = 'published'
       and edition.opens_at <= $2 and edition.closes_at > $2
     limit 1`,
    [gameId, now],
  );
  const game = result.rows[0];
  return game
    ? {
        contentVersion: game.contentVersion,
        id: game.id,
        payload: game.publicPayload,
        status: game.status,
        type: game.type,
      }
    : null;
}

export async function startGuestQuizAttempt(
  client: SqlClient,
  gameId: string,
  guestToken: string,
  now: Date,
): Promise<QuizAttemptState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new QuizAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return startQuizAttempt(transaction, gameId, { kind: "guest", id: guest.guestSessionId }, now);
  });
}

export async function startUserQuizAttempt(
  client: SqlClient,
  gameId: string,
  userId: string,
  now: Date,
): Promise<QuizAttemptState> {
  return client.transaction((transaction) =>
    startQuizAttempt(transaction, gameId, { kind: "user", id: userId }, now),
  );
}

export async function saveGuestQuizProgress(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  expectedVersion: number,
  events: readonly QuizProgressEvent[],
  now: Date,
): Promise<QuizProgressResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new QuizAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return saveQuizProgress(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      expectedVersion,
      events,
      now,
    );
  });
}

export async function saveUserQuizProgress(
  client: SqlClient,
  attemptId: string,
  userId: string,
  expectedVersion: number,
  events: readonly QuizProgressEvent[],
  now: Date,
): Promise<QuizProgressResult> {
  return client.transaction((transaction) =>
    saveQuizProgress(
      transaction,
      attemptId,
      { kind: "user", id: userId },
      expectedVersion,
      events,
      now,
    ),
  );
}

export async function submitGuestQuizAttempt(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  now: Date,
): Promise<QuizSubmitResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new QuizAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return submitQuizAttempt(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      now,
    );
  });
}

export async function submitUserQuizAttempt(
  client: SqlClient,
  attemptId: string,
  userId: string,
  now: Date,
): Promise<QuizSubmitResult> {
  return client.transaction((transaction) =>
    submitQuizAttempt(transaction, attemptId, { kind: "user", id: userId }, now),
  );
}

async function startQuizAttempt(
  transaction: TransactionClient,
  gameId: string,
  subject: AttemptSubject,
  now: Date,
): Promise<QuizAttemptState> {
  const game = await getQuizGame(transaction, gameId, now);
  if (!game) throw new QuizAttemptError("GAME_UNAVAILABLE", "El quiz no está disponible");
  validateQuiz(game.publicPayload, game.privatePayload.questions, validationOptionsFor(game.type));
  const subjectColumn = subject.kind === "guest" ? "guest_session_id" : "user_id";
  const attempt = await transaction.query<{ id: string; status: string; version: number }>(
    `insert into game_attempts (game_id, ${subjectColumn}, started_at)
     values ($1, $2, $3)
     on conflict (game_id, ${subjectColumn})
       where mode = 'competitive' and ${subjectColumn} is not null
     do update set updated_at = excluded.started_at
     returning id, status, version`,
    [gameId, subject.id, now],
  );
  const row = attempt.rows[0];
  if (!row) throw new Error("No se pudo iniciar el intento");
  return readAttemptState(transaction, row.id, row.status, row.version, new Date(game.closesAt));
}

async function saveQuizProgress(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  expectedVersion: number,
  events: readonly QuizProgressEvent[],
  now: Date,
): Promise<QuizProgressResult> {
  const attempt = await getAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new QuizAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }
  if (attempt.status !== "in_progress") {
    throw new QuizAttemptError("ATTEMPT_NOT_EDITABLE", "El intento ya está enviado");
  }
  if (attempt.version !== expectedVersion) {
    return {
      status: "conflict",
      state: await readAttemptState(transaction, attempt.id, attempt.status, attempt.version),
    };
  }

  let savedEvents = 0;
  for (const event of events) {
    assertValidAnswer(attempt.publicPayload, event);
    const inserted = await transaction.query(
      `insert into attempt_events
         (attempt_id, client_event_id, event_type, payload, client_occurred_at, received_at)
       values ($1, $2, 'answer_selected', $3::jsonb, $4, $5)
       on conflict (attempt_id, client_event_id) do nothing
       returning id`,
      [attempt.id, event.clientEventId, JSON.stringify(event), event.clientOccurredAt ?? null, now],
    );
    if (!inserted.rowCount) continue;

    await transaction.query(
      `insert into answers (attempt_id, question_id, selected_option_id, elapsed_ms)
       values ($1, $2, $3, $4)
       on conflict (attempt_id, question_id) do update
       set selected_option_id = excluded.selected_option_id,
           elapsed_ms = excluded.elapsed_ms,
           updated_at = $5,
           version = answers.version + 1`,
      [attempt.id, event.questionId, event.selectedOptionId, event.elapsedMs, now],
    );
    savedEvents += 1;
  }

  if (!savedEvents) return { savedEvents: 0, status: "saved", version: attempt.version };
  const updated = await transaction.query<{ version: number }>(
    `update game_attempts
     set version = version + 1, updated_at = $2
     where id = $1
     returning version`,
    [attempt.id, now],
  );
  return {
    savedEvents,
    status: "saved",
    version: updated.rows[0]?.version ?? attempt.version + 1,
  };
}

async function submitQuizAttempt(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  now: Date,
): Promise<QuizSubmitResult> {
  const attempt = await getAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new QuizAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }

  const closesAt = new Date(attempt.closesAt);
  if (attempt.status === "accepted" || attempt.status === "finalized") {
    return readExistingResult(transaction, attempt.id, closesAt);
  }
  if (attempt.status !== "in_progress") {
    throw new QuizAttemptError("ATTEMPT_NOT_EDITABLE", "El intento no puede enviarse");
  }

  const answers = limitClientTimes(
    await readAnswers(transaction, attempt.id),
    Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime()),
  );
  const validationOptions = validationOptionsFor(attempt.type);
  validateQuiz(attempt.publicPayload, attempt.privatePayload.questions, validationOptions);
  const score = calculateQuizScore(
    attempt.publicPayload,
    attempt.privatePayload.questions,
    answers,
    validationOptions,
  );
  const competitive = attempt.mode === "competitive" && now.getTime() < closesAt.getTime();
  const durationMs = answers.reduce((total, answer) => total + answer.elapsedMs, 0);

  await transaction.query(
    `insert into scores (attempt_id, points, score_version, competitive, duration_ms, breakdown)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (attempt_id) do nothing`,
    [
      attempt.id,
      score.points,
      score.scoreVersion,
      competitive,
      durationMs,
      JSON.stringify({ completed: score.completed, correctCount: score.correctCount }),
    ],
  );
  await transaction.query(
    `update game_attempts
     set status = 'accepted', submitted_at = $2, server_received_at = $2,
         updated_at = $2, version = version + 1
     where id = $1 and status = 'in_progress'`,
    [attempt.id, now],
  );
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('GameAttempt', $1, 'GameAttemptAccepted', $2::jsonb)`,
    [attempt.id, JSON.stringify({ competitive, gameId: attempt.gameId, points: score.points })],
  );

  return toSubmitResult(attempt.id, competitive, score.completed, score.points, closesAt);
}

async function getQuizGame(
  transaction: TransactionClient,
  gameId: string,
  now: Date,
): Promise<GameRow | null> {
  const result = await transaction.query<GameRow>(
    `select game.id, game.type, game.status, game.public_payload as "publicPayload",
            game.content_version as "contentVersion", solution.private_payload as "privatePayload",
            edition.closes_at as "closesAt"
     from games game
     join daily_editions edition on edition.id = game.edition_id
     join game_solutions solution on solution.game_id = game.id
     where game.id = $1 and game.type in ('quiz', 'true_false') and game.status = 'active'
       and edition.status = 'published' and edition.opens_at <= $2 and edition.closes_at > $2
     limit 1`,
    [gameId, now],
  );
  return result.rows[0] ?? null;
}

async function getAttemptForUpdate(
  transaction: TransactionClient,
  attemptId: string,
): Promise<AttemptRow | null> {
  const result = await transaction.query<AttemptRow>(
    `select attempt.id, attempt.game_id as "gameId",
            attempt.guest_session_id as "guestSessionId", attempt.user_id as "userId",
            attempt.status, attempt.mode,
            attempt.version, attempt.started_at as "startedAt", game.type,
            game.public_payload as "publicPayload",
            solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join game_solutions solution on solution.game_id = game.id
     join daily_editions edition on edition.id = game.edition_id
     where attempt.id = $1
     for update`,
    [attemptId],
  );
  return result.rows[0] ?? null;
}

function ownsAttempt(attempt: AttemptRow, subject: AttemptSubject): boolean {
  return subject.kind === "guest"
    ? attempt.guestSessionId === subject.id
    : attempt.userId === subject.id;
}

function validationOptionsFor(type: "quiz" | "true_false"): QuizValidationOptions | undefined {
  return type === "true_false" ? { maxQuestions: 20, minQuestions: 3, optionCount: 2 } : undefined;
}

async function readAttemptState(
  transaction: TransactionClient,
  attemptId: string,
  status: string,
  version: number,
  closesAt?: Date,
): Promise<QuizAttemptState> {
  const answers = await readAnswers(transaction, attemptId);
  const accepted = status !== "in_progress";
  return {
    answers,
    attemptId,
    ...(accepted && closesAt
      ? { result: await readExistingResult(transaction, attemptId, closesAt) }
      : {}),
    status: accepted ? "accepted" : "in_progress",
    version,
  };
}

async function readAnswers(
  transaction: TransactionClient,
  attemptId: string,
): Promise<QuizAttemptAnswer[]> {
  const result = await transaction.query<QuizAttemptAnswer & QueryResultRow>(
    `select question_id as "questionId", selected_option_id as "selectedOptionId",
            elapsed_ms as "elapsedMs"
     from answers where attempt_id = $1 order by created_at`,
    [attemptId],
  );
  return result.rows;
}

async function readExistingResult(
  transaction: TransactionClient,
  attemptId: string,
  closesAt: Date,
): Promise<QuizSubmitResult> {
  const result = await transaction.query<ScoreRow>(
    `select points, competitive, (breakdown->>'completed')::boolean as completed
     from scores where attempt_id = $1`,
    [attemptId],
  );
  const score = result.rows[0];
  if (!score) throw new Error("El intento aceptado no tiene puntuación");
  return toSubmitResult(attemptId, score.competitive, score.completed, score.points, closesAt);
}

function assertValidAnswer(quiz: QuizPublicPayload, answer: QuizProgressEvent): void {
  const question = quiz.questions.find((item) => item.id === answer.questionId);
  if (
    !question ||
    !question.options.some((option) => option.id === answer.selectedOptionId) ||
    !Number.isInteger(answer.elapsedMs) ||
    answer.elapsedMs < 0 ||
    answer.elapsedMs > 3_600_000
  ) {
    throw new QuizAttemptError("INVALID_ANSWER", "La respuesta no pertenece al quiz");
  }
}

function limitClientTimes(
  answers: readonly QuizAttemptAnswer[],
  serverElapsedMs: number,
): QuizAttemptAnswer[] {
  if (!answers.length) return [];
  const clientElapsedMs = answers.reduce((total, answer) => total + answer.elapsedMs, 0);
  const minimumElapsedMs = Math.max(0, serverElapsedMs - 2_000);
  if (clientElapsedMs >= minimumElapsedMs) return [...answers];
  if (!clientElapsedMs) {
    const elapsedMs = Math.round(minimumElapsedMs / answers.length);
    return answers.map((answer) => ({ ...answer, elapsedMs }));
  }
  const factor = minimumElapsedMs / clientElapsedMs;
  return answers.map((answer) => ({
    ...answer,
    elapsedMs: Math.min(3_600_000, Math.round(answer.elapsedMs * factor)),
  }));
}

function toSubmitResult(
  attemptId: string,
  competitive: boolean,
  completed: boolean,
  score: number,
  closesAt: Date,
): QuizSubmitResult {
  return {
    attemptId,
    competitive,
    provisional: { completed, score },
    solutionAvailableAt: closesAt.toISOString(),
    status: "accepted",
  };
}
