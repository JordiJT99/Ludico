import { progressionFromEvents, type PlayerProgression } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import { authenticateGuestSession } from "./guests.js";
import type { SqlClient } from "./sql-client.js";

type Player = { kind: "guest"; token: string } | { kind: "user"; userId: string };

interface ExperienceRow extends QueryResultRow {
  amount: number;
  createdAt: Date | string;
  kind: "completion" | "daily_double";
}

export async function getPlayerProgression(
  client: SqlClient,
  player: Player,
  now: Date,
): Promise<PlayerProgression | null> {
  if (player.kind === "guest") {
    const guest = await client.transaction((transaction) =>
      authenticateGuestSession(transaction, player.token, now),
    );
    return guest ? readProgression(client, "guest_session_id", guest.guestSessionId) : null;
  }
  return readProgression(client, "user_id", player.userId);
}

async function readProgression(
  client: SqlClient,
  column: "guest_session_id" | "user_id",
  id: string,
): Promise<PlayerProgression> {
  const events = await client.query<ExperienceRow>(
    `select experience.kind, experience.amount, experience.created_at as "createdAt"
     from experience_transactions experience
     join game_attempts attempt on attempt.id = experience.attempt_id
     where attempt.${column} = $1
     order by experience.created_at, experience.id`,
    [id],
  );
  return progressionFromEvents(
    events.rows.map((event) => ({ ...event, recordedAt: event.createdAt })),
  );
}
