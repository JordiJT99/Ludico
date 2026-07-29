import type { QueryResultRow } from "pg";
import type { TransactionClient } from "./sql-client.js";

export interface AdminAuditRecord {
  readonly action: string;
  readonly actorId: string | null;
  readonly actorType: string;
  readonly correlationId: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly reason: string | null;
  readonly targetId: string;
  readonly targetType: string;
}

interface AdminAuditRow extends QueryResultRow {
  action: string;
  actorId: string | null;
  actorType: string;
  correlationId: string;
  id: string;
  occurredAt: Date | string;
  reason: string | null;
  targetId: string;
  targetType: string;
}

export async function listAdminAudit(
  client: TransactionClient,
  limit = 50,
): Promise<readonly AdminAuditRecord[]> {
  const result = await client.query<AdminAuditRow>(
    `select id, actor_type as "actorType", actor_id as "actorId", action,
            target_type as "targetType", target_id as "targetId", reason,
            correlation_id as "correlationId", occurred_at as "occurredAt"
     from audit_logs order by occurred_at desc, id desc limit $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows.map((row) => ({
    ...row,
    occurredAt: new Date(row.occurredAt).toISOString(),
  }));
}
