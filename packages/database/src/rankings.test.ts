import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGuestSession } from "./guests.js";
import {
  getGuestLeaderboard,
  getGuestShareResultData,
  getUserLeaderboard,
  getUserLeaderboardSettings,
  getUserPreviousResults,
  getUserStreak,
  updateUserLeaderboardSettings,
} from "./rankings.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];
const now = new Date("2026-07-30T12:00:00Z");
const gameId = "22222222-2222-4222-8222-222222222222";
const userOne = "33333333-3333-4333-8333-333333333331";
const userTwo = "33333333-3333-4333-8333-333333333332";

afterEach(async () => Promise.all(databases.splice(0).map((database) => database.close())));

describe("leaderboards and streaks", () => {
  it("keeps aliases opt-in while returning a private position to every owner", async () => {
    const { client, guest } = await setup();
    const game = await getGuestLeaderboard(client, "game", gameId, guest.token, now);
    expect(game).toEqual({
      entries: [{ alias: "Ana", durationMs: 20_000, points: 900, rank: 1 }],
      key: gameId,
      own: { durationMs: 30_000, percentile: 67, points: 850, rank: 2, total: 3 },
      scope: "game",
    });
    expect(await getUserLeaderboard(client, "daily", "2026-07-30", userTwo)).toMatchObject({
      entries: [{ alias: "Ana", rank: 1 }],
      own: { percentile: 34, rank: 3, total: 3 },
    });

    expect(
      await updateUserLeaderboardSettings(
        client,
        userTwo,
        { alias: "  Beto  ", leaderboardOptIn: true },
        now,
      ),
    ).toEqual({ alias: "Beto", leaderboardOptIn: true });
    expect(await getUserLeaderboardSettings(client, userTwo)).toEqual({
      alias: "Beto",
      leaderboardOptIn: true,
    });
    expect(await getUserLeaderboard(client, "weekly", "2026-07-27", userTwo)).toMatchObject({
      entries: [
        { alias: "Ana", rank: 1 },
        { alias: "Beto", rank: 3 },
      ],
    });
    expect(
      await getGuestShareResultData(
        client,
        "44444444-4444-4444-8444-444444444449",
        guest.token,
        now,
      ),
    ).toEqual({ competitive: true, gameId, gameType: "quiz", points: 850 });
  });

  it("counts at most one completed game per local date", async () => {
    const { client } = await setup();
    expect(await getUserStreak(client, userOne, "2026-07-30")).toEqual({
      best: 3,
      current: 3,
      lastCompletedDate: "2026-07-30",
    });
  });

  it("returns the account result from the previous Madrid date", async () => {
    const { client } = await setup();
    expect(await getUserPreviousResults(client, userOne, now)).toEqual([
      {
        attemptId: "44444444-4444-4444-8444-444444444441",
        competitive: true,
        gameId: "22222222-2222-4222-8222-222222222221",
        gameType: "quiz",
        localDate: "2026-07-29",
        points: 900,
        rank: 1,
        total: 1,
      },
    ]);
  });
});

async function setup() {
  const database = new PGlite();
  databases.push(database);
  await migrate(drizzle(database), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  const client = new PGliteClient(database);
  const guest = await createGuestSession(client, "web", now);
  await database.query(
    `insert into users
       (id, auth_provider, external_subject, email_normalized, public_alias, leaderboard_opt_in)
     values ($1, 'supabase', 'one', 'one@example.com', 'Ana', true),
            ($2, 'supabase', 'two', 'two@example.com', null, false)`,
    [userOne, userTwo],
  );
  const dates = ["2026-07-28", "2026-07-29", "2026-07-30"];
  for (let index = 0; index < dates.length; index += 1) {
    const editionId = `11111111-1111-4111-8111-11111111111${index}`;
    const currentGameId = index === 2 ? gameId : `22222222-2222-4222-8222-22222222222${index}`;
    const attemptId = `44444444-4444-4444-8444-44444444444${index}`;
    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at)
       values ($1, $2::date, 'closed', $2::date, $2::date + 1)`,
      [editionId, dates[index]],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload)
       values ($1, $2, 'quiz', '{}'::jsonb)`,
      [currentGameId, editionId],
    );
    await database.query(
      `insert into game_attempts
         (id, game_id, user_id, status, submitted_at, server_received_at)
       values ($1, $2, $3, 'accepted', $4, $4)`,
      [attemptId, currentGameId, userOne, `${dates[index]}T12:00:00Z`],
    );
    await database.query(
      `insert into scores
         (attempt_id, points, score_version, competitive, duration_ms, breakdown)
       values ($1, 900, 'quiz-v1', true, 20000, '{"completed":true}'::jsonb)`,
      [attemptId],
    );
  }
  await addRankedAttempt(database, userTwo, null, 800, 10_000, 8);
  await addRankedAttempt(database, null, guest.guestSessionId, 850, 30_000, 9);
  return { client, database, guest };
}

async function addRankedAttempt(
  database: PGlite,
  userId: string | null,
  guestSessionId: string | null,
  points: number,
  durationMs: number,
  suffix: number,
) {
  const attemptId = `44444444-4444-4444-8444-44444444444${suffix}`;
  await database.query(
    `insert into game_attempts
       (id, game_id, user_id, guest_session_id, status, submitted_at, server_received_at)
     values ($1, $2, $3, $4, 'accepted', $5, $5)`,
    [attemptId, gameId, userId, guestSessionId, `2026-07-30T12:00:0${suffix}Z`],
  );
  await database.query(
    `insert into scores
       (attempt_id, points, score_version, competitive, duration_ms, breakdown)
     values ($1, $2, 'quiz-v1', true, $3, '{"completed":true}'::jsonb)`,
    [attemptId, points, durationMs],
  );
}
