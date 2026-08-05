import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

const publicationSettingsAggregateId = "00000000-0000-4000-8000-000000000001";

export interface PublicationSettings {
  readonly closesAtLocalTime: string;
  readonly contentPlanLocalTime: string;
  readonly market: "ES";
  readonly opensAtLocalTime: string;
  readonly reserveDays: number;
}

export const defaultPublicationSettings: PublicationSettings = {
  closesAtLocalTime: "00:00",
  contentPlanLocalTime: "02:00",
  market: "ES",
  opensAtLocalTime: "00:00",
  reserveDays: 14,
};

export async function getPublicationSettings(client: SqlClient): Promise<PublicationSettings> {
  const result = await client.query<PublicationSettings & QueryResultRow>(
    `select market, opens_at_local_time as "opensAtLocalTime",
            closes_at_local_time as "closesAtLocalTime",
            content_plan_local_time as "contentPlanLocalTime", reserve_days as "reserveDays"
     from publication_settings where market = 'ES'`,
  );
  return result.rows[0] ?? defaultPublicationSettings;
}

export async function updatePublicationSettings(
  client: SqlClient,
  settings: Omit<PublicationSettings, "market">,
  actorId: string,
  reason: string,
  correlationId: string,
  now: Date,
): Promise<PublicationSettings> {
  if (
    !isTime(settings.opensAtLocalTime) ||
    !isTime(settings.closesAtLocalTime) ||
    !isTime(settings.contentPlanLocalTime) ||
    settings.reserveDays < 7 ||
    settings.reserveDays > 21 ||
    !Number.isInteger(settings.reserveDays) ||
    reason.trim().length < 10
  ) {
    throw new RangeError("PUBLICATION_SETTINGS_INVALID");
  }
  return client.transaction(async (transaction) => {
    const result = await transaction.query<PublicationSettings & QueryResultRow>(
      `insert into publication_settings
         (market, opens_at_local_time, closes_at_local_time, content_plan_local_time, reserve_days,
          created_at, updated_at)
       values ('ES', $1, $2, $3, $4, $5, $5)
       on conflict (market) do update
       set opens_at_local_time = excluded.opens_at_local_time,
           closes_at_local_time = excluded.closes_at_local_time,
           content_plan_local_time = excluded.content_plan_local_time,
           reserve_days = excluded.reserve_days,
           updated_at = excluded.updated_at,
           version = publication_settings.version + 1
       returning market, opens_at_local_time as "opensAtLocalTime",
                 closes_at_local_time as "closesAtLocalTime",
                 content_plan_local_time as "contentPlanLocalTime", reserve_days as "reserveDays"`,
      [
        settings.opensAtLocalTime,
        settings.closesAtLocalTime,
        settings.contentPlanLocalTime,
        settings.reserveDays,
        now,
      ],
    );
    await recordChange(transaction, actorId, reason.trim(), correlationId);
    return result.rows[0]!;
  });
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function recordChange(
  transaction: TransactionClient,
  actorId: string,
  reason: string,
  correlationId: string,
): Promise<void> {
  await transaction.query(
    `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
     values ('PublicationSettings', $1, 'PublicationSettingsUpdated', $2::jsonb)`,
    [publicationSettingsAggregateId, JSON.stringify({ reason })],
  );
  await transaction.query(
    `insert into audit_logs
       (actor_type, actor_id, action, target_type, target_id, reason, correlation_id, metadata)
     values ('admin', $1, 'update_publication_settings', 'PublicationSettings', 'ES', $2, $3, '{}'::jsonb)`,
    [actorId, reason, correlationId],
  );
}
