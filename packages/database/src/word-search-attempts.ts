import type {
  QuizSubmitResult,
  WordSearchAttemptState,
  WordSearchFoundEntry,
  WordSearchPublicPayload,
  WordSearchSelectionEvent,
  WordSearchSelectionResult,
} from "@ludico/contracts";
import { validateWordSearch, type WordSearchEntry } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

type Subject = { kind: "guest"; id: string } | { kind: "user"; id: string };
type Solution = {
  readonly entries: readonly WordSearchEntry[];
  readonly kind: "word-search-solution";
};

interface GameRow extends QueryResultRow {
  closesAt: Date | string;
  privatePayload: Solution;
  publicPayload: WordSearchPublicPayload;
}
interface AttemptRow extends QueryResultRow {
  closesAt: Date | string;
  gameId: string;
  guestSessionId: string | null;
  id: string;
  mode: "competitive" | "casual";
  privatePayload: Solution;
  publicPayload: WordSearchPublicPayload;
  startedAt: Date | string;
  status: string;
  userId: string | null;
  version: number;
}
interface ScoreRow extends QueryResultRow {
  competitive: boolean;
  points: number;
}

export type WordSearchAttemptErrorCode =
  | "ATTEMPT_NOT_EDITABLE"
  | "ATTEMPT_NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "INVALID_SELECTION"
  | "UNAUTHORIZED"
  | "VERSION_CONFLICT";

export class WordSearchAttemptError extends Error {
  constructor(
    readonly code: WordSearchAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WordSearchAttemptError";
  }
}

export async function startGuestWordSearchAttempt(
  client: SqlClient,
  gameId: string,
  guestToken: string,
  now: Date,
): Promise<WordSearchAttemptState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new WordSearchAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return startAttempt(transaction, gameId, { kind: "guest", id: guest.guestSessionId }, now);
  });
}

export function startUserWordSearchAttempt(
  client: SqlClient,
  gameId: string,
  userId: string,
  now: Date,
): Promise<WordSearchAttemptState> {
  return client.transaction((transaction) =>
    startAttempt(transaction, gameId, { kind: "user", id: userId }, now),
  );
}

export async function recordGuestWordSearchSelection(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  event: WordSearchSelectionEvent,
  now: Date,
): Promise<WordSearchSelectionResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new WordSearchAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return recordSelection(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      event,
      now,
    );
  });
}

export function recordUserWordSearchSelection(
  client: SqlClient,
  attemptId: string,
  userId: string,
  event: WordSearchSelectionEvent,
  now: Date,
): Promise<WordSearchSelectionResult> {
  return client.transaction((transaction) =>
    recordSelection(transaction, attemptId, { kind: "user", id: userId }, event, now),
  );
}

async function startAttempt(
  transaction: TransactionClient,
  gameId: string,
  subject: Subject,
  now: Date,
): Promise<WordSearchAttemptState> {
  const game = await getGame(transaction, gameId, now);
  if (!game) throw new WordSearchAttemptError("GAME_UNAVAILABLE", "El reto no está disponible");
  validateGame(game.publicPayload, game.privatePayload);
  const column = subject.kind === "guest" ? "guest_session_id" : "user_id";
  const created = await transaction.query<{ id: string; status: string; version: number }>(
    `insert into game_attempts (game_id, ${column}, started_at) values ($1, $2, $3)
     on conflict (game_id, ${column}) where mode = 'competitive' and ${column} is not null
     do update set updated_at = excluded.started_at returning id, status, version`,
    [gameId, subject.id, now],
  );
  const row = created.rows[0];
  if (!row) throw new Error("No se pudo iniciar el intento");
  return readState(transaction, row.id, row.status, row.version, new Date(game.closesAt));
}

async function recordSelection(
  transaction: TransactionClient,
  attemptId: string,
  subject: Subject,
  event: WordSearchSelectionEvent,
  now: Date,
): Promise<WordSearchSelectionResult> {
  const attempt = await getAttempt(transaction, attemptId);
  if (!attempt || !owns(attempt, subject))
    throw new WordSearchAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  validateGame(attempt.publicPayload, attempt.privatePayload);
  assertEvent(event, attempt.publicPayload);
  if (attempt.status !== "in_progress")
    throw new WordSearchAttemptError("ATTEMPT_NOT_EDITABLE", "El intento ya está enviado");
  const duplicateEvent = await transaction.query<{ id: string }>(
    "select id from attempt_events where attempt_id = $1 and client_event_id = $2 limit 1",
    [attempt.id, event.clientEventId],
  );
  if (duplicateEvent.rows[0]) {
    return {
      attempt: await readState(transaction, attempt.id, attempt.status, attempt.version),
      outcome: "already_found",
    };
  }
  if (attempt.version !== event.version)
    throw new WordSearchAttemptError("VERSION_CONFLICT", "El progreso ha cambiado");
  const entryIndex = attempt.publicPayload.words.findIndex((word) => word.id === event.entryId);
  const solution = attempt.privatePayload.entries[entryIndex];
  if (!solution || !matchesSelection(solution, event)) {
    return {
      attempt: await readState(transaction, attempt.id, attempt.status, attempt.version),
      outcome: "incorrect",
    };
  }
  const alreadyFound = await transaction.query<{ id: string }>(
    "select id from word_search_finds where attempt_id = $1 and entry_id = $2 limit 1",
    [attempt.id, event.entryId],
  );
  if (alreadyFound.rows[0]) {
    return {
      attempt: await readState(transaction, attempt.id, attempt.status, attempt.version),
      outcome: "already_found",
    };
  }
  await transaction.query(
    `insert into attempt_events (attempt_id, client_event_id, event_type, payload, client_occurred_at, received_at)
     values ($1, $2, 'word_found', $3::jsonb, $4, $5)`,
    [attempt.id, event.clientEventId, JSON.stringify(event), event.clientOccurredAt ?? null, now],
  );
  await transaction.query(
    `insert into word_search_finds (attempt_id, entry_id, elapsed_ms, created_at, updated_at)
     values ($1, $2, $3, $4, $4)`,
    [attempt.id, event.entryId, event.elapsedMs, now],
  );
  const version = (
    await transaction.query<{ version: number }>(
      "update game_attempts set version = version + 1, updated_at = $2 where id = $1 returning version",
      [attempt.id, now],
    )
  ).rows[0]?.version;
  if (!version) throw new Error("No se pudo guardar la selección");
  const found = await readFound(transaction, attempt.id);
  if (found.length < attempt.publicPayload.words.length) {
    return {
      attempt: { attemptId: attempt.id, foundEntries: found, status: "in_progress", version },
      outcome: "found",
    };
  }
  const result = await accept(transaction, attempt, found, now);
  return {
    attempt: {
      attemptId: attempt.id,
      foundEntries: found,
      result,
      status: "accepted",
      version: version + 1,
    },
    outcome: "found",
  };
}

async function accept(
  transaction: TransactionClient,
  attempt: AttemptRow,
  found: readonly WordSearchFoundEntry[],
  now: Date,
): Promise<QuizSubmitResult> {
  const closesAt = new Date(attempt.closesAt);
  const competitive = attempt.mode === "competitive" && now < closesAt;
  const points = 1_000;
  const durationMs = Math.max(
    found.reduce((sum, entry) => sum + entry.elapsedMs, 0),
    Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime() - 2_000),
  );
  await transaction.query(
    `insert into scores (attempt_id, points, score_version, competitive, duration_ms, breakdown)
     values ($1, $2, 'word-search-v1', $3, $4, '{"completed":true}'::jsonb) on conflict (attempt_id) do nothing`,
    [attempt.id, points, competitive, durationMs],
  );
  await transaction.query(
    `update game_attempts set status = 'accepted', submitted_at = $2, server_received_at = $2, updated_at = $2, version = version + 1
     where id = $1 and status = 'in_progress'`,
    [attempt.id, now],
  );
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('GameAttempt', $1, 'GameAttemptAccepted', $2::jsonb)`,
    [attempt.id, JSON.stringify({ competitive, gameId: attempt.gameId, points })],
  );
  return {
    attemptId: attempt.id,
    competitive,
    provisional: { completed: true, score: points },
    solutionAvailableAt: closesAt.toISOString(),
    status: "accepted",
  };
}

async function getGame(
  transaction: TransactionClient,
  gameId: string,
  now: Date,
): Promise<GameRow | null> {
  const result = await transaction.query<GameRow>(
    `select game.public_payload as "publicPayload", solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from games game join daily_editions edition on edition.id = game.edition_id join game_solutions solution on solution.game_id = game.id
     where game.id = $1 and game.type = 'word_search' and game.status = 'active' and edition.status = 'published'
       and edition.opens_at <= $2 and edition.closes_at > $2 limit 1`,
    [gameId, now],
  );
  return result.rows[0] ?? null;
}

async function getAttempt(
  transaction: TransactionClient,
  attemptId: string,
): Promise<AttemptRow | null> {
  const result = await transaction.query<AttemptRow>(
    `select attempt.id, attempt.game_id as "gameId", attempt.guest_session_id as "guestSessionId", attempt.user_id as "userId", attempt.status, attempt.mode, attempt.version, attempt.started_at as "startedAt", game.public_payload as "publicPayload", solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from game_attempts attempt join games game on game.id = attempt.game_id join game_solutions solution on solution.game_id = game.id join daily_editions edition on edition.id = game.edition_id
     where attempt.id = $1 and game.type = 'word_search' for update`,
    [attemptId],
  );
  return result.rows[0] ?? null;
}

async function readState(
  transaction: TransactionClient,
  attemptId: string,
  status: string,
  version: number,
  closesAt?: Date,
): Promise<WordSearchAttemptState> {
  const foundEntries = await readFound(transaction, attemptId);
  const accepted = status !== "in_progress";
  return {
    attemptId,
    foundEntries,
    ...(accepted && closesAt
      ? { result: await existingResult(transaction, attemptId, closesAt) }
      : {}),
    status: accepted ? "accepted" : "in_progress",
    version,
  };
}

async function readFound(
  transaction: TransactionClient,
  attemptId: string,
): Promise<WordSearchFoundEntry[]> {
  return (
    await transaction.query<WordSearchFoundEntry & QueryResultRow>(
      `select entry_id as "entryId", elapsed_ms as "elapsedMs" from word_search_finds where attempt_id = $1 order by created_at`,
      [attemptId],
    )
  ).rows;
}

async function existingResult(
  transaction: TransactionClient,
  attemptId: string,
  closesAt: Date,
): Promise<QuizSubmitResult> {
  const score = (
    await transaction.query<ScoreRow>(
      "select points, competitive from scores where attempt_id = $1",
      [attemptId],
    )
  ).rows[0];
  if (!score) throw new Error("El intento aceptado no tiene puntuación");
  return {
    attemptId,
    competitive: score.competitive,
    provisional: { completed: true, score: score.points },
    solutionAvailableAt: closesAt.toISOString(),
    status: "accepted",
  };
}

function validateGame(game: WordSearchPublicPayload, solution: Solution): void {
  if (game.words.length !== solution.entries.length)
    throw new WordSearchAttemptError("INVALID_SELECTION", "La sopa no es válida");
  if (solution.entries.some((entry, index) => game.words[index]?.answer !== entry.answer))
    throw new WordSearchAttemptError("INVALID_SELECTION", "La sopa no es válida");
  validateWordSearch({
    columns: game.columns,
    entries: solution.entries,
    grid: game.grid,
    rows: game.rows,
    seed: game.seed,
  });
}

function assertEvent(event: WordSearchSelectionEvent, game: WordSearchPublicPayload): void {
  if (
    !game.words.some((word) => word.id === event.entryId) ||
    !Number.isInteger(event.version) ||
    event.version < 1 ||
    !Number.isInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    event.elapsedMs > 3_600_000 ||
    !isCoordinate(event.startRow, event.startColumn, game) ||
    !isCoordinate(event.endRow, event.endColumn, game)
  ) {
    throw new WordSearchAttemptError("INVALID_SELECTION", "La selección no es válida");
  }
}

function isCoordinate(row: number, column: number, game: WordSearchPublicPayload): boolean {
  return (
    Number.isInteger(row) &&
    Number.isInteger(column) &&
    row >= 0 &&
    column >= 0 &&
    row < game.rows &&
    column < game.columns
  );
}

function matchesSelection(entry: WordSearchEntry, event: WordSearchSelectionEvent): boolean {
  const vectors: Record<WordSearchEntry["direction"], readonly [number, number]> = {
    east: [0, 1],
    west: [0, -1],
    north: [-1, 0],
    south: [1, 0],
    northEast: [-1, 1],
    northWest: [-1, -1],
    southEast: [1, 1],
    southWest: [1, -1],
  };
  const [row, column] = vectors[entry.direction];
  const endRow = entry.row + row * (entry.answer.length - 1);
  const endColumn = entry.column + column * (entry.answer.length - 1);
  return (
    (event.startRow === entry.row &&
      event.startColumn === entry.column &&
      event.endRow === endRow &&
      event.endColumn === endColumn) ||
    (event.endRow === entry.row &&
      event.endColumn === entry.column &&
      event.startRow === endRow &&
      event.startColumn === endColumn)
  );
}

function owns(attempt: AttemptRow, subject: Subject): boolean {
  return subject.kind === "guest"
    ? attempt.guestSessionId === subject.id
    : attempt.userId === subject.id;
}
