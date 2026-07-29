import { createHash, randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type GuestOrigin = "web" | "android" | "ios";

export interface GuestCredential {
  readonly expiresAt: string;
  readonly guestSessionId: string;
  readonly token: string;
}

export interface AuthenticatedGuest {
  readonly expiresAt: string;
  readonly guestSessionId: string;
  readonly origin: GuestOrigin;
}

interface GuestRow extends QueryResultRow {
  expiresAt: Date | string;
  id: string;
  origin: GuestOrigin;
}

export class GuestTokenError extends Error {
  readonly code = "INVALID_GUEST_TOKEN";

  constructor() {
    super("La sesión invitada no es válida o ha caducado");
    this.name = "GuestTokenError";
  }
}

export async function createGuestSession(
  client: TransactionClient,
  origin: GuestOrigin,
  now = new Date(),
): Promise<GuestCredential> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_MS);
  const result = await client.query<{ id: string }>(
    `insert into guest_sessions (token_hash, origin, expires_at, last_seen_at)
     values ($1, $2, $3, $4)
     returning id`,
    [hashGuestToken(token), origin, expiresAt, now],
  );
  const created = result.rows[0];
  if (!created) throw new Error("No se pudo crear la sesión invitada");

  return { expiresAt: expiresAt.toISOString(), guestSessionId: created.id, token };
}

export async function authenticateGuestSession(
  client: TransactionClient,
  token: string,
  now = new Date(),
): Promise<AuthenticatedGuest | null> {
  const result = await client.query<GuestRow>(
    `update guest_sessions
     set last_seen_at = $2, updated_at = $2, version = version + 1
     where token_hash = $1 and status = 'active' and expires_at > $2
     returning id, origin, expires_at as "expiresAt"`,
    [hashGuestToken(token), now],
  );
  const row = result.rows[0];
  const subjectId = row ? await findGuestSubjectId(client, row.id) : null;
  return row
    ? {
        expiresAt: new Date(row.expiresAt).toISOString(),
        guestSessionId: subjectId ?? row.id,
        origin: row.origin,
      }
    : null;
}

async function findGuestSubjectId(client: TransactionClient, sessionId: string) {
  const result = await client.query<{ id: string } & QueryResultRow>(
    `with recursive lineage(id, previous_session_id, depth) as (
       select id, previous_session_id, 0 from guest_sessions where id = $1
       union all
       select parent.id, parent.previous_session_id, child.depth + 1
       from guest_sessions parent
       join lineage child on parent.id = child.previous_session_id
     )
     select id from lineage order by depth desc limit 1`,
    [sessionId],
  );
  return result.rows[0]?.id ?? null;
}

export async function rotateGuestSession(
  client: SqlClient,
  token: string,
  now = new Date(),
): Promise<GuestCredential> {
  return client.transaction(async (transaction) => {
    const current = await findActiveGuestForUpdate(transaction, token, now);
    if (!current) throw new GuestTokenError();

    const nextToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_MS);
    const inserted = await transaction.query<{ id: string }>(
      `insert into guest_sessions
         (token_hash, origin, expires_at, last_seen_at, previous_session_id)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [hashGuestToken(nextToken), current.origin, expiresAt, now, current.id],
    );
    await transaction.query(
      `update guest_sessions
       set status = 'rotated', rotated_at = $2, updated_at = $2, version = version + 1
       where id = $1 and status = 'active'`,
      [current.id, now],
    );
    const created = inserted.rows[0];
    if (!created) throw new Error("No se pudo rotar la sesión invitada");

    return {
      expiresAt: expiresAt.toISOString(),
      guestSessionId: created.id,
      token: nextToken,
    };
  });
}

export async function revokeGuestSession(
  client: TransactionClient,
  token: string,
  now = new Date(),
): Promise<boolean> {
  const result = await client.query(
    `update guest_sessions
     set status = 'revoked', revoked_at = $2, updated_at = $2, version = version + 1
     where token_hash = $1 and status = 'active'`,
    [hashGuestToken(token), now],
  );
  return result.rowCount > 0;
}

export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function findActiveGuestForUpdate(
  transaction: TransactionClient,
  token: string,
  now: Date,
): Promise<GuestRow | null> {
  const result = await transaction.query<GuestRow>(
    `select id, origin, expires_at as "expiresAt"
     from guest_sessions
     where token_hash = $1 and status = 'active' and expires_at > $2
     for update`,
    [hashGuestToken(token), now],
  );
  return result.rows[0] ?? null;
}
