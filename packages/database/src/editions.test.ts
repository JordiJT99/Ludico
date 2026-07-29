import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  getEditionByDate,
  getGameSolution,
  getPublishedEdition,
  reconcileDueEditions,
} from "./editions.js";
import { PGliteClient } from "./test-support/pglite-client.js";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("daily edition publication", () => {
  it("publishes and closes once without exposing a solution early", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const editionId = "11111111-1111-4111-8111-111111111111";
    const gameId = "22222222-2222-4222-8222-222222222222";

    await database.query(
      `insert into daily_editions
         (id, local_date, status, opens_at, closes_at)
       values ($1, '2026-07-28', 'scheduled', $2, $3)`,
      [editionId, "2026-07-27T22:00:00Z", "2026-07-28T22:00:00Z"],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload)
       values ($1, $2, 'quiz', $3::jsonb)`,
      [gameId, editionId, JSON.stringify({ title: "Quiz diario" })],
    );
    await database.query(
      `insert into game_solutions (game_id, private_payload)
       values ($1, $2::jsonb)`,
      [
        gameId,
        JSON.stringify({
          kind: "quiz-solution",
          questions: [
            {
              correctOptionId: "77777777-7777-4777-8777-777777777777",
              explanation: "Explicación pública tras el cierre",
              questionId: "66666666-6666-4666-8666-666666666666",
            },
          ],
        }),
      ],
    );

    const published = await reconcileDueEditions(client, new Date("2026-07-27T22:00:01Z"));
    expect(published).toEqual([{ editionId, from: "scheduled", to: "published" }]);
    expect(await reconcileDueEditions(client, new Date("2026-07-27T22:00:02Z"))).toEqual([]);

    const publicEdition = await getPublishedEdition(client, new Date("2026-07-28T12:00:00Z"));
    expect(publicEdition?.games).toHaveLength(1);
    expect(JSON.stringify(publicEdition)).not.toContain("correctOptionId");
    const beforeClose = await database.query<{ public_payload: unknown }>(
      "select public_payload from game_solutions where game_id = $1",
      [gameId],
    );
    expect(beforeClose.rows[0]?.public_payload).toBeNull();
    expect(await getGameSolution(client, gameId, new Date("2026-07-28T12:00:00Z"))).toEqual({
      status: "locked",
    });

    const playerId = "33333333-3333-4333-8333-333333333333";
    const attemptId = "44444444-4444-4444-8444-444444444444";
    await database.query(
      `insert into users (id, auth_provider, external_subject, email_normalized)
       values ($1, 'supabase', 'finalized-player', 'finalized@example.com')`,
      [playerId],
    );
    await database.query(
      `insert into game_attempts
         (id, game_id, user_id, status, mode, submitted_at, server_received_at)
       values ($1, $2, $3, 'accepted', 'casual', $4, $4)`,
      [attemptId, gameId, playerId, "2026-07-28T21:00:00Z"],
    );

    const closed = await reconcileDueEditions(client, new Date("2026-07-28T22:00:00Z"));
    expect(closed).toEqual([{ editionId, from: "published", to: "closed" }]);
    expect(await getPublishedEdition(client, new Date("2026-07-28T22:00:00Z"))).toBeNull();
    expect(
      (
        await database.query<{ status: string }>("select status from game_attempts where id = $1", [
          attemptId,
        ])
      ).rows[0]?.status,
    ).toBe("finalized");
    expect(
      (
        await database.query<{ payload: { finalizedAttempts?: number } }>(
          "select payload from outbox_events where event_type = 'DailyEditionClosed'",
        )
      ).rows[0]?.payload,
    ).toMatchObject({ finalizedAttempts: 1 });
    expect(
      await getEditionByDate(client, "2026-07-28", new Date("2026-07-29T12:00:00Z")),
    ).toMatchObject({ id: editionId, localDate: "2026-07-28" });
    expect(
      await getEditionByDate(client, "2026-07-28", new Date("2026-08-06T12:00:00Z")),
    ).toBeNull();
    const afterClose = await database.query<{ public_payload: Record<string, string> }>(
      "select public_payload from game_solutions where game_id = $1",
      [gameId],
    );
    const publicPayload = {
      kind: "quiz-solution",
      questions: [
        {
          correctOptionId: "77777777-7777-4777-8777-777777777777",
          explanation: "Explicación pública tras el cierre",
          questionId: "66666666-6666-4666-8666-666666666666",
        },
      ],
    };
    expect(afterClose.rows[0]?.public_payload).toEqual(publicPayload);
    expect(await getGameSolution(client, gameId, new Date("2026-07-28T22:00:00Z"))).toEqual({
      status: "available",
      solution: {
        gameId,
        game: {
          contentVersion: 1,
          id: gameId,
          payload: { title: "Quiz diario" },
          status: "active",
          type: "quiz",
        },
        payload: publicPayload,
        publishedAt: "2026-07-28T22:00:00.000Z",
      },
    });

    await database.query(
      `with created_users as (
         insert into users (auth_provider, external_subject, email_normalized)
         select 'supabase', 'statistics-' || value::text,
                'statistics-' || value::text || '@example.com'
         from generate_series(1, 20) value
         returning id
       )
       insert into game_attempts
         (game_id, user_id, status, submitted_at, server_received_at)
       select $1, id, 'accepted', $2, $2 from created_users`,
      [gameId, "2026-07-28T21:00:00Z"],
    );
    await database.query(
      `insert into scores
         (attempt_id, points, score_version, competitive, duration_ms, breakdown)
       select id, 800, 'quiz-v1', true, 30000, '{}'::jsonb
       from game_attempts where game_id = $1 and mode = 'competitive'`,
      [gameId],
    );
    await database.query(
      `insert into answers (attempt_id, question_id, selected_option_id, elapsed_ms)
       select ranked.id, $2,
              case when ranked.position <= 15 then $3::uuid else $4::uuid end, 1000
       from (
         select id, row_number() over (order by id) as position
         from game_attempts where game_id = $1 and mode = 'competitive'
       ) ranked`,
      [
        gameId,
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
      ],
    );
    const withStatistics = await getGameSolution(client, gameId, new Date("2026-07-28T22:00:00Z"));
    expect(withStatistics.status).toBe("available");
    if (withStatistics.status === "available") {
      expect(withStatistics.solution.statistics).toEqual({
        attemptCount: 20,
        averageDurationMs: 30000,
        averageScore: 800,
        quizQuestions: [{ correctPercent: 75, questionId: "66666666-6666-4666-8666-666666666666" }],
      });
    }
  });

  it("publishes per-word failure only for a sufficiently large competitive cohort", async () => {
    const database = new PGlite();
    databases.push(database);
    await migrate(drizzle(database), {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const client = new PGliteClient(database);
    const editionId = "11111111-1111-4111-8111-111111111112";
    const gameId = "22222222-2222-4222-8222-222222222223";
    const entryId = "33333333-3333-4333-8333-333333333333";
    const cellIds = [
      "44444444-4444-4444-8444-444444444441",
      "44444444-4444-4444-8444-444444444442",
      "44444444-4444-4444-8444-444444444443",
    ];
    const publicGame = {
      blocks: [
        { column: 0, row: 1 },
        { column: 1, row: 1 },
        { column: 2, row: 1 },
        { column: 0, row: 2 },
        { column: 1, row: 2 },
        { column: 2, row: 2 },
      ],
      cells: cellIds.map((id, column) => ({
        column,
        id,
        ...(column === 0 ? { number: 1 } : {}),
        row: 0,
      })),
      columns: 3,
      entries: [{ cellIds, clue: "Astro", direction: "across", id: entryId, number: 1 }],
      kind: "crossword",
      rows: 3,
      rules: { accentPolicy: "fold" },
      title: "Crucigrama diario",
    };
    const publicSolution = {
      entries: [{ answer: "SOL", entryId }],
      kind: "crossword-solution",
    };

    await database.query(
      `insert into daily_editions (id, local_date, status, opens_at, closes_at, closed_at)
       values ($1, '2026-07-28', 'closed', '2026-07-27T22:00:00Z',
               '2026-07-28T22:00:00Z', '2026-07-28T22:00:00Z')`,
      [editionId],
    );
    await database.query(
      `insert into games (id, edition_id, type, public_payload)
       values ($1, $2, 'crossword', $3::jsonb)`,
      [gameId, editionId, JSON.stringify(publicGame)],
    );
    await database.query(
      `insert into game_solutions (game_id, private_payload, public_payload, published_at)
       values ($1, $2::jsonb, $2::jsonb, '2026-07-28T22:00:00Z')`,
      [gameId, JSON.stringify(publicSolution)],
    );
    await database.query(
      `with created_users as (
         insert into users (auth_provider, external_subject, email_normalized)
         select 'supabase', 'crossword-statistics-' || value::text,
                'crossword-statistics-' || value::text || '@example.com'
         from generate_series(1, 20) value returning id
       )
       insert into game_attempts (game_id, user_id, status, submitted_at, server_received_at)
       select $1, id, 'accepted', '2026-07-28T21:00:00Z', '2026-07-28T21:00:00Z'
       from created_users`,
      [gameId],
    );
    await database.query(
      `insert into scores (attempt_id, points, score_version, competitive, duration_ms, breakdown)
       select id, 1000, 'crossword-v1', true, 40000, '{}'::jsonb
       from game_attempts where game_id = $1`,
      [gameId],
    );
    await database.query(
      `insert into crossword_cells (attempt_id, cell_id, value, elapsed_ms)
       select ranked.id, input.cell_id,
              case when ranked.position <= 10 or input.position < 3 then input.value else 'X' end,
              1000
       from (
         select id, row_number() over (order by id) as position
         from game_attempts where game_id = $1
       ) ranked
       cross join (values ($2::uuid, 'S', 1), ($3::uuid, 'O', 2), ($4::uuid, 'L', 3))
         input(cell_id, value, position)`,
      [gameId, ...cellIds],
    );

    const result = await getGameSolution(client, gameId, new Date("2026-07-29T12:00:00Z"));
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.solution.statistics?.crosswordEntries).toEqual([
        { entryId, incorrectPercent: 50 },
      ]);
    }
  });
});
