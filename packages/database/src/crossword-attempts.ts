import type {
  CrosswordAttemptCell,
  CrosswordAttemptState,
  CrosswordHintResult,
  CrosswordProgressEvent,
  CrosswordPublicPayload,
  CrosswordSubmitResult,
} from "@ludico/contracts";
import {
  calculateCrosswordScore,
  getCrosswordSolutionLetter,
  normalizeCrosswordLetter,
  type CrosswordPrivateSolution,
  validateCrossword,
} from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

interface CrosswordGameRow extends QueryResultRow {
  closesAt: Date | string;
  id: string;
  privatePayload: CrosswordPrivateSolution;
  publicPayload: CrosswordPublicPayload;
}

interface CrosswordAttemptRow extends QueryResultRow {
  closesAt: Date | string;
  gameId: string;
  guestSessionId: string | null;
  id: string;
  mode: "competitive" | "casual";
  privatePayload: CrosswordPrivateSolution;
  publicPayload: CrosswordPublicPayload;
  status: string;
  startedAt: Date | string;
  userId: string | null;
  version: number;
}

type AttemptSubject = { kind: "guest"; id: string } | { kind: "user"; id: string };

interface ScoreRow extends QueryResultRow {
  competitive: boolean;
  completed: boolean;
  points: number;
}

export type CrosswordAttemptErrorCode =
  | "ATTEMPT_NOT_EDITABLE"
  | "ATTEMPT_NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "INVALID_CELL"
  | "UNAUTHORIZED";

export class CrosswordAttemptError extends Error {
  constructor(
    readonly code: CrosswordAttemptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CrosswordAttemptError";
  }
}

export type CrosswordProgressResult =
  | { status: "saved"; savedEvents: number; version: number }
  | { status: "conflict"; state: CrosswordAttemptState };

export async function getAttemptGameType(
  client: TransactionClient,
  attemptId: string,
): Promise<"quiz" | "crossword" | "true_false" | "guess_word" | null> {
  const result = await client.query<
    { type: "quiz" | "crossword" | "true_false" | "guess_word" } & QueryResultRow
  >(
    `select game.type
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     where attempt.id = $1`,
    [attemptId],
  );
  return result.rows[0]?.type ?? null;
}

export async function startGuestCrosswordAttempt(
  client: SqlClient,
  gameId: string,
  guestToken: string,
  now: Date,
): Promise<CrosswordAttemptState> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new CrosswordAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return startCrosswordAttempt(
      transaction,
      gameId,
      { kind: "guest", id: guest.guestSessionId },
      now,
    );
  });
}

export async function startUserCrosswordAttempt(
  client: SqlClient,
  gameId: string,
  userId: string,
  now: Date,
): Promise<CrosswordAttemptState> {
  return client.transaction((transaction) =>
    startCrosswordAttempt(transaction, gameId, { kind: "user", id: userId }, now),
  );
}

export async function saveGuestCrosswordProgress(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  expectedVersion: number,
  events: readonly CrosswordProgressEvent[],
  now: Date,
): Promise<CrosswordProgressResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new CrosswordAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return saveCrosswordProgress(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      expectedVersion,
      events,
      now,
    );
  });
}

export async function saveUserCrosswordProgress(
  client: SqlClient,
  attemptId: string,
  userId: string,
  expectedVersion: number,
  events: readonly CrosswordProgressEvent[],
  now: Date,
): Promise<CrosswordProgressResult> {
  return client.transaction((transaction) =>
    saveCrosswordProgress(
      transaction,
      attemptId,
      { kind: "user", id: userId },
      expectedVersion,
      events,
      now,
    ),
  );
}

export async function submitGuestCrosswordAttempt(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  now: Date,
): Promise<CrosswordSubmitResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new CrosswordAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return submitCrosswordAttempt(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      now,
    );
  });
}

export async function submitUserCrosswordAttempt(
  client: SqlClient,
  attemptId: string,
  userId: string,
  now: Date,
): Promise<CrosswordSubmitResult> {
  return client.transaction((transaction) =>
    submitCrosswordAttempt(transaction, attemptId, { kind: "user", id: userId }, now),
  );
}

export async function revealGuestCrosswordCell(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  cellId: string,
  clientEventId: string,
  now: Date,
): Promise<CrosswordHintResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new CrosswordAttemptError("UNAUTHORIZED", "Sesión invitada no válida");
    return revealCrosswordCell(
      transaction,
      attemptId,
      { kind: "guest", id: guest.guestSessionId },
      cellId,
      clientEventId,
      now,
    );
  });
}

export async function revealUserCrosswordCell(
  client: SqlClient,
  attemptId: string,
  userId: string,
  cellId: string,
  clientEventId: string,
  now: Date,
): Promise<CrosswordHintResult> {
  return client.transaction((transaction) =>
    revealCrosswordCell(
      transaction,
      attemptId,
      { kind: "user", id: userId },
      cellId,
      clientEventId,
      now,
    ),
  );
}

async function startCrosswordAttempt(
  transaction: TransactionClient,
  gameId: string,
  subject: AttemptSubject,
  now: Date,
): Promise<CrosswordAttemptState> {
  const game = await getCrosswordGame(transaction, gameId, now);
  if (!game) {
    throw new CrosswordAttemptError("GAME_UNAVAILABLE", "El crucigrama no está disponible");
  }
  validateCrossword(game.publicPayload, game.privatePayload);
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
  return readCrosswordAttemptState(
    transaction,
    row.id,
    row.status,
    row.version,
    new Date(game.closesAt),
  );
}

async function saveCrosswordProgress(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  expectedVersion: number,
  events: readonly CrosswordProgressEvent[],
  now: Date,
): Promise<CrosswordProgressResult> {
  const attempt = await getCrosswordAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new CrosswordAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }
  if (attempt.status !== "in_progress") {
    throw new CrosswordAttemptError("ATTEMPT_NOT_EDITABLE", "El intento ya está enviado");
  }
  if (attempt.version !== expectedVersion) {
    return {
      status: "conflict",
      state: await readCrosswordAttemptState(
        transaction,
        attempt.id,
        attempt.status,
        attempt.version,
      ),
    };
  }

  let savedEvents = 0;
  for (const event of events) {
    const value = assertValidCell(attempt.publicPayload, event);
    const inserted = await transaction.query(
      `insert into attempt_events
         (attempt_id, client_event_id, event_type, payload, client_occurred_at, received_at)
       values ($1, $2, 'cell_set', $3::jsonb, $4, $5)
       on conflict (attempt_id, client_event_id) do nothing
       returning id`,
      [
        attempt.id,
        event.clientEventId,
        JSON.stringify({ ...event, value }),
        event.clientOccurredAt ?? null,
        now,
      ],
    );
    if (!inserted.rowCount) continue;

    if (!value) {
      await transaction.query(
        `delete from crossword_cells where attempt_id = $1 and cell_id = $2`,
        [attempt.id, event.cellId],
      );
    } else {
      await transaction.query(
        `insert into crossword_cells (attempt_id, cell_id, value, elapsed_ms)
         values ($1, $2, $3, $4)
         on conflict (attempt_id, cell_id) do update
         set value = excluded.value,
             elapsed_ms = excluded.elapsed_ms,
             updated_at = $5,
             version = crossword_cells.version + 1`,
        [attempt.id, event.cellId, value, event.elapsedMs, now],
      );
    }
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

async function submitCrosswordAttempt(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  now: Date,
): Promise<CrosswordSubmitResult> {
  const attempt = await getCrosswordAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new CrosswordAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }

  const closesAt = new Date(attempt.closesAt);
  if (attempt.status === "accepted" || attempt.status === "finalized") {
    return readExistingResult(transaction, attempt.id, closesAt);
  }
  if (attempt.status !== "in_progress") {
    throw new CrosswordAttemptError("ATTEMPT_NOT_EDITABLE", "El intento no puede enviarse");
  }

  validateCrossword(attempt.publicPayload, attempt.privatePayload);
  const cells = await readCrosswordCells(transaction, attempt.id);
  const hintsUsed = await readHintsUsed(transaction, attempt.id);
  const score = calculateCrosswordScore(
    attempt.publicPayload,
    attempt.privatePayload,
    cells,
    hintsUsed,
  );
  const competitive =
    attempt.mode === "competitive" && hintsUsed === 0 && now.getTime() < closesAt.getTime();
  const durationMs = Math.min(
    2_147_483_647,
    Math.max(0, now.getTime() - new Date(attempt.startedAt).getTime()),
  );

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
      JSON.stringify({
        completed: score.completed,
        completedWords: score.completedWords,
        correctLetters: score.correctLetters,
        hintsUsed,
        solved: score.solved,
      }),
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

async function revealCrosswordCell(
  transaction: TransactionClient,
  attemptId: string,
  subject: AttemptSubject,
  cellId: string,
  clientEventId: string,
  now: Date,
): Promise<CrosswordHintResult> {
  const attempt = await getCrosswordAttemptForUpdate(transaction, attemptId);
  if (!attempt || !ownsAttempt(attempt, subject)) {
    throw new CrosswordAttemptError("ATTEMPT_NOT_FOUND", "El intento no existe");
  }
  if (attempt.status !== "in_progress") {
    throw new CrosswordAttemptError("ATTEMPT_NOT_EDITABLE", "El intento ya está enviado");
  }

  const value = getCrosswordSolutionLetter(attempt.publicPayload, attempt.privatePayload, cellId);
  const existing = await transaction.query(
    `select id from attempt_events
     where attempt_id = $1 and event_type = 'hint_revealed' and payload->>'cellId' = $2
     limit 1`,
    [attempt.id, cellId],
  );
  let version = attempt.version;
  if (!existing.rows.length) {
    const inserted = await transaction.query(
      `insert into attempt_events
         (attempt_id, client_event_id, event_type, payload, received_at)
       values ($1, $2, 'hint_revealed', $3::jsonb, $4)
       on conflict (attempt_id, client_event_id) do nothing
       returning id`,
      [attempt.id, clientEventId, JSON.stringify({ cellId }), now],
    );
    if (!inserted.rowCount) {
      throw new CrosswordAttemptError("INVALID_CELL", "El evento de ayuda ya se utilizó");
    }
    await transaction.query(
      `insert into crossword_cells (attempt_id, cell_id, value, elapsed_ms)
       values ($1, $2, $3, 0)
       on conflict (attempt_id, cell_id) do update
       set value = excluded.value, elapsed_ms = 0, updated_at = $4,
           version = crossword_cells.version + 1`,
      [attempt.id, cellId, value, now],
    );
    const updated = await transaction.query<{ version: number }>(
      `update game_attempts
       set version = version + 1, updated_at = $2
       where id = $1
       returning version`,
      [attempt.id, now],
    );
    version = updated.rows[0]?.version ?? attempt.version + 1;
  }

  return {
    attemptId: attempt.id,
    cellId,
    competitive: false,
    hintsUsed: await readHintsUsed(transaction, attempt.id),
    value,
    version,
  };
}

async function getCrosswordGame(
  transaction: TransactionClient,
  gameId: string,
  now: Date,
): Promise<CrosswordGameRow | null> {
  const result = await transaction.query<CrosswordGameRow>(
    `select game.id, game.public_payload as "publicPayload",
            solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from games game
     join daily_editions edition on edition.id = game.edition_id
     join game_solutions solution on solution.game_id = game.id
     where game.id = $1 and game.type = 'crossword' and game.status = 'active'
       and edition.status = 'published' and edition.opens_at <= $2 and edition.closes_at > $2
     limit 1`,
    [gameId, now],
  );
  return result.rows[0] ?? null;
}

async function getCrosswordAttemptForUpdate(
  transaction: TransactionClient,
  attemptId: string,
): Promise<CrosswordAttemptRow | null> {
  const result = await transaction.query<CrosswordAttemptRow>(
    `select attempt.id, attempt.game_id as "gameId",
            attempt.guest_session_id as "guestSessionId", attempt.user_id as "userId",
            attempt.status, attempt.mode,
            attempt.version, attempt.started_at as "startedAt",
            game.public_payload as "publicPayload",
            solution.private_payload as "privatePayload", edition.closes_at as "closesAt"
     from game_attempts attempt
     join games game on game.id = attempt.game_id and game.type = 'crossword'
     join game_solutions solution on solution.game_id = game.id
     join daily_editions edition on edition.id = game.edition_id
     where attempt.id = $1
     for update`,
    [attemptId],
  );
  return result.rows[0] ?? null;
}

function ownsAttempt(attempt: CrosswordAttemptRow, subject: AttemptSubject): boolean {
  return subject.kind === "guest"
    ? attempt.guestSessionId === subject.id
    : attempt.userId === subject.id;
}

async function readCrosswordAttemptState(
  transaction: TransactionClient,
  attemptId: string,
  status: string,
  version: number,
  closesAt?: Date,
): Promise<CrosswordAttemptState> {
  const accepted = status !== "in_progress";
  return {
    attemptId,
    cells: await readCrosswordCells(transaction, attemptId),
    hintsUsed: await readHintsUsed(transaction, attemptId),
    ...(accepted && closesAt
      ? { result: await readExistingResult(transaction, attemptId, closesAt) }
      : {}),
    status: accepted ? "accepted" : "in_progress",
    version,
  };
}

async function readCrosswordCells(
  transaction: TransactionClient,
  attemptId: string,
): Promise<CrosswordAttemptCell[]> {
  const result = await transaction.query<CrosswordAttemptCell & QueryResultRow>(
    `select cell_id as "cellId", value, elapsed_ms as "elapsedMs"
     from crossword_cells where attempt_id = $1 order by created_at`,
    [attemptId],
  );
  return result.rows;
}

async function readHintsUsed(transaction: TransactionClient, attemptId: string): Promise<number> {
  const result = await transaction.query<{ count: number } & QueryResultRow>(
    `select count(*)::int as count
     from attempt_events where attempt_id = $1 and event_type = 'hint_revealed'`,
    [attemptId],
  );
  return result.rows[0]?.count ?? 0;
}

async function readExistingResult(
  transaction: TransactionClient,
  attemptId: string,
  closesAt: Date,
): Promise<CrosswordSubmitResult> {
  const result = await transaction.query<ScoreRow>(
    `select points, competitive, (breakdown->>'completed')::boolean as completed
     from scores where attempt_id = $1`,
    [attemptId],
  );
  const score = result.rows[0];
  if (!score) throw new Error("El intento aceptado no tiene puntuación");
  return toSubmitResult(attemptId, score.competitive, score.completed, score.points, closesAt);
}

function assertValidCell(crossword: CrosswordPublicPayload, event: CrosswordProgressEvent): string {
  const value = event.value === "" ? "" : normalizeCrosswordLetter(event.value);
  if (
    !crossword.cells.some((cell) => cell.id === event.cellId) ||
    value === null ||
    !Number.isInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    event.elapsedMs > 3_600_000
  ) {
    throw new CrosswordAttemptError("INVALID_CELL", "La celda no pertenece al crucigrama");
  }
  return value;
}

function toSubmitResult(
  attemptId: string,
  competitive: boolean,
  completed: boolean,
  score: number,
  closesAt: Date,
): CrosswordSubmitResult {
  return {
    attemptId,
    competitive,
    provisional: { completed, score },
    solutionAvailableAt: closesAt.toISOString(),
    status: "accepted",
  };
}
