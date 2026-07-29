import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

export class AdminCommandError extends Error {
  constructor(
    readonly code: "EDITION_NOT_READY" | "GAME_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AdminCommandError";
  }
}

export async function scheduleReserveEdition(
  client: SqlClient,
  editionId: string,
  reason: string,
  correlationId: string,
  actor: Readonly<{ id?: string; type: "admin" | "emergency_admin" }> = {
    type: "emergency_admin",
  },
): Promise<{ changed: boolean; status: "scheduled" }> {
  return client.transaction(async (transaction) => {
    const ready = await transaction.query<{ status: string; gameCount: number }>(
      `select edition.status, count(distinct game.type)::int as "gameCount"
       from daily_editions edition
       left join games game on game.edition_id = edition.id and game.status = 'active'
       left join game_solutions solution on solution.game_id = game.id
       where edition.id = $1
       group by edition.id
       having count(game.id) = count(solution.game_id)`,
      [editionId],
    );
    const row = ready.rows[0];
    if (row?.status === "scheduled") return { changed: false, status: "scheduled" };
    if (row?.status !== "approved" || row.gameCount !== 2) {
      throw new AdminCommandError(
        "EDITION_NOT_READY",
        "La edición necesita quiz y crucigrama activos, con solución, y estado approved",
      );
    }

    await transaction.query(
      `update daily_editions
       set status = 'scheduled', updated_at = now(), version = version + 1
       where id = $1 and status = 'approved'`,
      [editionId],
    );
    await recordAdminChange(transaction, {
      action: "schedule",
      correlationId,
      eventType: "DailyEditionScheduled",
      reason,
      targetId: editionId,
      targetType: "DailyEdition",
      actor,
    });
    return { changed: true, status: "scheduled" };
  });
}

export async function disableGame(
  client: SqlClient,
  gameId: string,
  reason: string,
  correlationId: string,
): Promise<{ changed: boolean; status: "disabled" }> {
  return client.transaction(async (transaction) => {
    const result = await transaction.query<{ status: string }>(
      `update games
       set status = 'disabled', updated_at = now(), version = version + 1
       where id = $1 and status = 'active'
       returning status`,
      [gameId],
    );
    if (!result.rowCount) {
      const existing = await transaction.query<{ status: string }>(
        "select status from games where id = $1",
        [gameId],
      );
      if (existing.rows[0]?.status === "disabled") return { changed: false, status: "disabled" };
      throw new AdminCommandError("GAME_NOT_FOUND", "El juego no existe");
    }

    await recordAdminChange(transaction, {
      action: "disable",
      correlationId,
      eventType: "GameDisabled",
      reason,
      targetId: gameId,
      targetType: "Game",
    });
    return { changed: true, status: "disabled" };
  });
}

interface AdminChange extends QueryResultRow {
  action: string;
  actor?: Readonly<{ id?: string; type: "admin" | "emergency_admin" }>;
  correlationId: string;
  eventType: string;
  reason: string;
  targetId: string;
  targetType: string;
}

async function recordAdminChange(
  transaction: TransactionClient,
  change: AdminChange,
): Promise<void> {
  const payload = JSON.stringify({ reason: change.reason });
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ($1, $2, $3, $4::jsonb)`,
    [change.targetType, change.targetId, change.eventType, payload],
  );
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)`,
    [
      change.actor?.type ?? "emergency_admin",
      change.actor?.id ?? null,
      change.action,
      change.targetType,
      change.targetId,
      change.reason,
      change.correlationId,
    ],
  );
}
