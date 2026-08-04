import type {
  GuessWordAttempt,
  GuessWordAttemptState,
  GuessWordGuessEvent,
  GuessWordGuessResult,
  GuessWordPublicPayload,
  QuizSubmitResult,
} from "@ludico/contracts";
import { foldCrosswordLetter, validateGuessWord } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

type AttemptSubject = { kind: "guest"; id: string } | { kind: "user"; id: string };

type GuessWordSolution = {
  readonly alternativeAnswers: readonly string[];
  readonly answer: string;
  readonly kind: "guess-word-solution";
};

interface GameRow extends QueryResultRow {
  closesAt: Date | string;
  privatePayload: GuessWordSolution;
  publicPayload: GuessWordPublicPayload;
}

interface AttemptRow extends QueryResultRow {
  closesAt: Date | string;
  gameId: string;
  guestSessionId: string | null;
  id: string;
  mode: "competitive" | "casual";
  privatePayload: GuessWordSolution;
  publicPayload: GuessWordPublicPayload;
  startedAt: Date | string;
  status: string;
  userId: string | null;
  version: number;
}

interface ScoreRow extends QueryResultRow {
  competitive: boolean;
  completed: boolean;
  points: number;
}

export type GuessWordAttemptErrorCode =
  | "ATTEMPT_NOT_EDITABLE"
  | "ATTEMPT_NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "INVALID_GUESS"
  | "UNAUTHORIZED"
  | "VERSION_CONFLICT";

export class GuessWordAttemptError extends Error {
  constructor(
    readonly code: GuessWordAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuessWordAttemptError";
  }
}

export async function startGuestGuessWordAttempt(
  client: SqlClient,
  gameId: string,
  guestToken: string,
  now: Date,
): Promise<GuessWordAttemptState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuessWordAttemptError("UNAUTHORIZED", "SesiÃ³n invitada no vÃ¡lida");
    return startAttempt(transaction, gameId, { kind: "guest", id: guest.guestSessionId }, now);
  });
}

export async function startUserGuessWordAttempt(
  client: SqlClient,
  gameId: string,
  userId: string,
  now: Date,
): Promise<GuessWordAttemptState> {
  return client.transaction((transaction) =>
    startAttempt(transaction, gameId, { kind: "user", id: userId }, now),
  );
}

export async function recordGuestGuessWordGuess(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  event: GuessWordGuessEvent,
  now: Date,
): Promise<GuessWordGuessResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuessWordAttemptError("UNAUTHORIZED", "SesiÃ³n invitada no vÃ¡lida");
    return recordGuess(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      event,
      now,
    );
  });
}

export async function recordUserGuessWordGuess(
  client: SqlClient,
  attemptId: string,
  userId: string,
  event: GuessWordGuessEvent,
  now: Date,
): Promise<GuessWordGuessResult> {
  return client.transaction((transaction) =>
    recordGuess(transaction, attemptId, { kind: "user", id: userId }, event, now),
  );
}

async function startAttempt(
  transaction: TransactionClient,
  gameId: string,
  subject: AttemptSubject,
  now: Date,
): Promise<GuessWordAttemptState> {
  const game = await getGame(transaction, gameId, now);
  if (!game) throw new GuessWordAttemptError("GAME_UNAVAILABLE", "El reto no estÃ¡ disponible");
  validateGame(game.publicPayload, game.privatePayload);
  const subjectColumn = subject.kind === "guest" ? "guest_session_id" : "user_id";
  const created = await transaction.query<{ id: string; status: string; version: number }>(
    `insert into game_attempts (game_id, ${subjectColumn}, started_at)
     values ($1, $2, $3)
     on conflict (game_id, ${subjectColumn})
       where mode = 'competitive' and ${subjectColumn} is not null
     do update set updated_at = excluded.started_at
     returning id, status, version`,
    [gameId, subject.id, now],
  );
  const row = created.rows[0];
  if (!row) throw new Error("No se pudo iniciar el intento");
  return readAttemptState(transaction, row.id, row.status, row.version, new Date(game.closesAt));
}

async function recordGuess(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  event: GuessWordGuessEvent,
  now: Date,
): Promise<GuessWordGuessResult> {
  const attempt = await getAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new GuessWordAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }
  validateGame(attempt.publicPayload, attempt.privatePayload);
  assertEvent(event, attempt.publicPayload);

  const duplicate = await transaction.query<{ outcome: GuessWordGuessResult["outcome"] }>(
    `select case
       when exists (select 1 from word_guesses where attempt_id = $1 and is_correct) then 'correct'
       when (select count(*) from word_guesses where attempt_id = $1) >= $2 then 'exhausted'
       else 'incorrect'
     end as outcome
     from attempt_events event
     where event.attempt_id = $1 and event.client_event_id = $3
     limit 1`,
    [attempt.id, attempt.publicPayload.maxAttempts, event.clientEventId],
  );
  if (duplicate.rows[0]) {
    return {
      attempt: await readAttemptState(
        transaction,
        attempt.id,
        attempt.status,
        attempt.version,
        new Date(attempt.closesAt),
      ),
      outcome: duplicate.rows[0].outcome,
    };
  }
  if (attempt.status !== "in_progress") {
    throw new GuessWordAttemptError("ATTEMPT_NOT_EDITABLE", "El intento ya estÃ¡ enviado");
  }
  if (attempt.version !== event.version) {
    throw new GuessWordAttemptError("VERSION_CONFLICT", "El progreso ha cambiado");
  }

  const previous = await readGuesses(transaction, attempt.id);
  if (previous.length >= attempt.publicPayload.maxAttempts) {
    throw new GuessWordAttemptError("ATTEMPT_NOT_EDITABLE", "No quedan intentos");
  }
  const guess = normalizeGuess(event.guess);
  const acceptedAnswers = new Set([
    normalizeGuess(attempt.privatePayload.answer),
    ...attempt.privatePayload.alternativeAnswers.map(normalizeGuess),
  ]);
  const correct = acceptedAnswers.has(guess);
  await transaction.query(
    `insert into attempt_events
       (attempt_id, client_event_id, event_type, payload, client_occurred_at, received_at)
     values ($1, $2, 'word_guessed', $3::jsonb, $4, $5)`,
    [
      attempt.id,
      event.clientEventId,
      JSON.stringify({ ...event, guess }),
      event.clientOccurredAt ?? null,
      now,
    ],
  );
  await transaction.query(
    `insert into word_guesses (attempt_id, guess, elapsed_ms, is_correct, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [attempt.id, guess, event.elapsedMs, correct, now],
  );

  const exhausted = !correct && previous.length + 1 >= attempt.publicPayload.maxAttempts;
  const nextVersion = (
    await transaction.query<{ version: number }>(
      `update game_attempts set version = version + 1, updated_at = $2 where id = $1 returning version`,
      [attempt.id, now],
    )
  ).rows[0]?.version;
  if (!nextVersion) throw new Error("No se pudo guardar el intento");

  if (!correct && !exhausted) {
    return {
      attempt: await readAttemptState(transaction, attempt.id, "in_progress", nextVersion),
      outcome: "incorrect",
    };
  }
  const result = await acceptAttempt(transaction, attempt, previous.length + 1, correct, now);
  return {
    attempt: {
      guesses: await readGuesses(transaction, attempt.id),
      attemptId: attempt.id,
      result,
      status: "accepted",
      version: nextVersion + 1,
    },
    outcome: correct ? "correct" : "exhausted",
  };
}

async function acceptAttempt(
  transaction: TransactionClient,
  attempt: AttemptRow,
  guessCount: number,
  correct: boolean,
  now: Date,
): Promise<QuizSubmitResult> {
  const closesAt = new Date(attempt.closesAt);
  const competitive = attempt.mode === "competitive" && now.getTime() < closesAt.getTime();
  const guesses = await readGuesses(transaction, attempt.id);
  const durationMs = limitDuration(
    guesses.reduce((total, guess) => total + guess.elapsedMs, 0),
    now.getTime() - new Date(attempt.startedAt).getTime(),
  );
  const points = correct ? Math.max(100, 1_000 - (guessCount - 1) * 150) : 0;
  await transaction.query(
    `insert into scores (attempt_id, points, score_version, competitive, duration_ms, breakdown)
     values ($1, $2, 'guess-word-v1', $3, $4, $5::jsonb)
     on conflict (attempt_id) do nothing`,
    [attempt.id, points, competitive, durationMs, JSON.stringify({ completed: true, correct })],
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
    [attempt.id, JSON.stringify({ competitive, gameId: attempt.gameId, points })],
  );
  return toSubmitResult(attempt.id, competitive, points, closesAt);
}

async function getGame(
  transaction: TransactionClient,
  gameId: string,
  now: Date,
): Promise<GameRow | null> {
  const result = await transaction.query<GameRow>(
    `select game.public_payload as "publicPayload", solution.private_payload as "privatePayload",
            edition.closes_at as "closesAt"
     from games game
     join daily_editions edition on edition.id = game.edition_id
     join game_solutions solution on solution.game_id = game.id
     where game.id = $1 and game.type = 'guess_word' and game.status = 'active'
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
    `select attempt.id, attempt.game_id as "gameId", attempt.guest_session_id as "guestSessionId",
            attempt.user_id as "userId", attempt.status, attempt.mode, attempt.version,
            attempt.started_at as "startedAt", game.public_payload as "publicPayload",
            solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join game_solutions solution on solution.game_id = game.id
     join daily_editions edition on edition.id = game.edition_id
     where attempt.id = $1 and game.type = 'guess_word'
     for update`,
    [attemptId],
  );
  return result.rows[0] ?? null;
}

async function readAttemptState(
  transaction: TransactionClient,
  attemptId: string,
  status: string,
  version: number,
  closesAt?: Date,
): Promise<GuessWordAttemptState> {
  const guesses = await readGuesses(transaction, attemptId);
  const accepted = status !== "in_progress";
  return {
    guesses,
    attemptId,
    ...(accepted && closesAt
      ? { result: await readExistingResult(transaction, attemptId, closesAt) }
      : {}),
    status: accepted ? "accepted" : "in_progress",
    version,
  };
}

async function readGuesses(
  transaction: TransactionClient,
  attemptId: string,
): Promise<GuessWordAttempt[]> {
  return (
    await transaction.query<GuessWordAttempt & QueryResultRow>(
      `select guess, elapsed_ms as "elapsedMs" from word_guesses
       where attempt_id = $1 order by created_at`,
      [attemptId],
    )
  ).rows;
}

async function readExistingResult(
  transaction: TransactionClient,
  attemptId: string,
  closesAt: Date,
): Promise<QuizSubmitResult> {
  const score = (
    await transaction.query<ScoreRow>(
      `select points, competitive, (breakdown->>'completed')::boolean as completed
       from scores where attempt_id = $1`,
      [attemptId],
    )
  ).rows[0];
  if (!score) throw new Error("El intento aceptado no tiene puntuaciÃ³n");
  return toSubmitResult(attemptId, score.competitive, score.points, closesAt);
}

function validateGame(
  publicPayload: GuessWordPublicPayload,
  privatePayload: GuessWordSolution,
): void {
  validateGuessWord({ ...publicPayload, ...privatePayload });
}

function assertEvent(event: GuessWordGuessEvent, game: GuessWordPublicPayload): void {
  if (
    typeof event.clientEventId !== "string" ||
    !Number.isInteger(event.version) ||
    event.version < 1 ||
    !Number.isInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    event.elapsedMs > 3_600_000 ||
    !Array.from(normalizeGuess(event.guess)).every((letter) =>
      game.allowedCharacters.includes(letter),
    )
  ) {
    throw new GuessWordAttemptError("INVALID_GUESS", "La palabra no es vÃ¡lida");
  }
}

function normalizeGuess(value: string): string {
  const guess = foldCrosswordLetter(value.trim());
  if (!/^[A-ZÑ]{3,21}$/u.test(guess)) {
    throw new GuessWordAttemptError("INVALID_GUESS", "La palabra no es vÃ¡lida");
  }
  return guess;
}

function ownsAttempt(attempt: AttemptRow, subject: AttemptSubject): boolean {
  return subject.kind === "guest"
    ? attempt.guestSessionId === subject.id
    : attempt.userId === subject.id;
}

function limitDuration(clientDurationMs: number, serverDurationMs: number): number {
  return Math.max(clientDurationMs, Math.max(0, serverDurationMs - 2_000));
}

function toSubmitResult(
  attemptId: string,
  competitive: boolean,
  score: number,
  closesAt: Date,
): QuizSubmitResult {
  return {
    attemptId,
    competitive,
    provisional: { completed: true, score },
    solutionAvailableAt: closesAt.toISOString(),
    status: "accepted",
  };
}
