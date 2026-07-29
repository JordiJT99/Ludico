import {
  isCrosswordPublicSolutionPayload,
  isPublicCrosswordGame,
  isQuizPublicSolutionPayload,
  type PublicEdition,
  type PublicGame,
  type PublicSolution,
} from "@ludico/contracts";
import { foldCrosswordLetter } from "@ludico/domain";
import type { QueryResultRow } from "pg";
import type { SqlClient, TransactionClient } from "./sql-client.js";

interface EditionRow extends QueryResultRow {
  id: string;
  localDate: string;
  opensAt: Date | string;
  closesAt: Date | string;
  games: PublicGame[];
}

interface DueEditionRow extends QueryResultRow {
  id: string;
  status: "scheduled" | "published";
}

interface SolutionRow extends QueryResultRow {
  gameId: string;
  type: "quiz" | "crossword";
  status: "active" | "disabled";
  publicPayload: Record<string, unknown>;
  contentVersion: number;
  closesAt: Date | string;
  payload: Record<string, unknown> | null;
  publishedAt: Date | string | null;
}

interface SolutionStatisticsRow extends QueryResultRow {
  attemptCount: number;
  averageDurationMs: number;
  averageScore: number;
}

interface QuizAnswerCountRow extends QueryResultRow {
  count: number;
  questionId: string;
  selectedOptionId: string;
}

interface CrosswordStatisticCellRow extends QueryResultRow {
  attemptId: string;
  cellId: string;
  value: string;
}

export interface EditionTransition {
  readonly editionId: string;
  readonly from: "scheduled" | "published";
  readonly to: "published" | "closed";
}

export async function getPublishedEdition(
  client: TransactionClient,
  now: Date,
  market = "ES",
): Promise<PublicEdition | null> {
  const result = await client.query<EditionRow>(
    `select
       edition.id,
       edition.local_date::text as "localDate",
       edition.opens_at as "opensAt",
       edition.closes_at as "closesAt",
       coalesce(
         json_agg(json_build_object(
           'id', game.id,
           'type', game.type,
           'status', game.status,
           'payload', game.public_payload,
           'contentVersion', game.content_version
         ) order by game.type) filter (where game.id is not null),
         '[]'::json
       ) as games
     from daily_editions edition
     left join games game on game.edition_id = edition.id
     where edition.market = $1
       and edition.status = 'published'
       and edition.opens_at <= $2
       and edition.closes_at > $2
     group by edition.id
     limit 1`,
    [market, now],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    localDate: row.localDate,
    opensAt: new Date(row.opensAt).toISOString(),
    closesAt: new Date(row.closesAt).toISOString(),
    games: row.games,
  };
}

export async function getEditionByDate(
  client: TransactionClient,
  localDate: string,
  now: Date,
  market = "ES",
  historyDays = 7,
): Promise<PublicEdition | null> {
  const result = await client.query<EditionRow>(
    `select
       edition.id,
       edition.local_date::text as "localDate",
       edition.opens_at as "opensAt",
       edition.closes_at as "closesAt",
       coalesce(
         json_agg(json_build_object(
           'id', game.id,
           'type', game.type,
           'status', game.status,
           'payload', game.public_payload,
           'contentVersion', game.content_version
         ) order by game.type) filter (where game.id is not null),
         '[]'::json
       ) as games
     from daily_editions edition
     left join games game on game.edition_id = edition.id
     where edition.market = $1
       and edition.local_date = $2::date
       and edition.local_date between
         (($3::timestamptz at time zone 'Europe/Madrid')::date - $4::integer)
         and ($3::timestamptz at time zone 'Europe/Madrid')::date
       and edition.status in ('published', 'closed', 'archived')
       and edition.opens_at <= $3
     group by edition.id
     limit 1`,
    [market, localDate, now, Math.max(0, Math.min(historyDays, 31))],
  );
  const row = result.rows[0];
  return row
    ? {
        closesAt: new Date(row.closesAt).toISOString(),
        games: row.games,
        id: row.id,
        localDate: row.localDate,
        opensAt: new Date(row.opensAt).toISOString(),
      }
    : null;
}

export async function reconcileDueEditions(
  client: SqlClient,
  now: Date,
): Promise<readonly EditionTransition[]> {
  return client.transaction(async (transaction) => {
    const due = await transaction.query<DueEditionRow>(
      `select id, status
       from daily_editions
       where (status = 'scheduled' and opens_at <= $1 and closes_at > $1)
          or (status = 'published' and closes_at <= $1)
       order by opens_at
       for update skip locked`,
      [now],
    );
    const transitions: EditionTransition[] = [];

    for (const edition of due.rows) {
      const target = edition.status === "scheduled" ? "published" : "closed";
      const update = await transaction.query<{ id: string }>(
        `update daily_editions
         set status = $1,
             published_at = case when $1 = 'published' then $2 else published_at end,
             closed_at = case when $1 = 'closed' then $2 else closed_at end,
             updated_at = $2,
             version = version + 1
         where id = $3 and status = $4
         returning id`,
        [target, now, edition.id, edition.status],
      );
      if (!update.rowCount) continue;

      let finalizedAttempts = 0;
      if (target === "closed") {
        await publishSolutions(transaction, edition.id, now);
        const finalized = await transaction.query(
          `update game_attempts attempt
           set status = 'finalized', updated_at = $2, version = attempt.version + 1
           from games game
           where attempt.game_id = game.id
             and game.edition_id = $1
             and attempt.status = 'accepted'`,
          [edition.id, now],
        );
        finalizedAttempts = finalized.rowCount ?? 0;
      }

      const payload = {
        editionId: edition.id,
        from: edition.status,
        ...(target === "closed" ? { finalizedAttempts } : {}),
        to: target,
      };
      await transaction.query(
        `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
         values ('DailyEdition', $1, $2, $3::jsonb)`,
        [
          edition.id,
          target === "published" ? "DailyEditionPublished" : "DailyEditionClosed",
          JSON.stringify(payload),
        ],
      );
      await transaction.query(
        `insert into audit_logs
           (actor_type, action, target_type, target_id, reason, correlation_id, metadata)
         values ('system', $1, 'DailyEdition', $2, 'scheduled reconciliation', $3, $4::jsonb)`,
        [target, edition.id, `edition:${edition.id}:${target}`, JSON.stringify(payload)],
      );
      transitions.push({ editionId: edition.id, from: edition.status, to: target });
    }

    return transitions;
  });
}

export async function getGameSolution(
  client: TransactionClient,
  gameId: string,
  now: Date,
): Promise<
  { status: "available"; solution: PublicSolution } | { status: "locked" } | { status: "not_found" }
> {
  const result = await client.query<SolutionRow>(
    `select
       game.id as "gameId",
       game.type,
       game.status,
       game.public_payload as "publicPayload",
       game.content_version as "contentVersion",
       edition.closes_at as "closesAt",
       solution.public_payload as payload,
       solution.published_at as "publishedAt"
     from games game
     join daily_editions edition on edition.id = game.edition_id
     left join game_solutions solution on solution.game_id = game.id
     where game.id = $1
     limit 1`,
    [gameId],
  );
  const row = result.rows[0];
  if (!row) return { status: "not_found" };
  if (
    !row.payload ||
    !row.publishedAt ||
    new Date(row.closesAt).getTime() > now.getTime() ||
    new Date(row.publishedAt).getTime() > now.getTime()
  ) {
    return { status: "locked" };
  }

  const statisticResult = await client.query<SolutionStatisticsRow>(
    `select count(*)::integer as "attemptCount",
            round(avg(score.duration_ms))::integer as "averageDurationMs",
            round(avg(score.points))::integer as "averageScore"
     from game_attempts attempt
     join scores score on score.attempt_id = attempt.id and score.competitive = true
     where attempt.game_id = $1 and attempt.status in ('accepted', 'finalized')
     having count(*) >= 20`,
    [gameId],
  );
  const statistics = statisticResult.rows[0];
  const game: PublicGame = {
    contentVersion: row.contentVersion,
    id: row.gameId,
    payload: row.publicPayload,
    status: row.status,
    type: row.type,
  };
  const details = statistics
    ? await getSolutionStatisticDetails(client, game, row.payload, statistics.attemptCount)
    : {};

  return {
    status: "available",
    solution: {
      gameId: row.gameId,
      game,
      payload: row.payload,
      publishedAt: new Date(row.publishedAt).toISOString(),
      ...(statistics ? { statistics: { ...statistics, ...details } } : {}),
    },
  };
}

async function getSolutionStatisticDetails(
  client: TransactionClient,
  game: PublicGame,
  payload: Record<string, unknown>,
  attemptCount: number,
): Promise<Pick<NonNullable<PublicSolution["statistics"]>, "crosswordEntries" | "quizQuestions">> {
  if (game.type === "quiz" && isQuizPublicSolutionPayload(payload)) {
    const counts = await client.query<QuizAnswerCountRow>(
      `select answer.question_id::text as "questionId",
              answer.selected_option_id::text as "selectedOptionId", count(*)::integer as count
       from game_attempts attempt
       join scores score on score.attempt_id = attempt.id and score.competitive = true
       join answers answer on answer.attempt_id = attempt.id
       where attempt.game_id = $1 and attempt.status in ('accepted', 'finalized')
       group by answer.question_id, answer.selected_option_id`,
      [game.id],
    );
    return {
      quizQuestions: payload.questions.map((question) => ({
        correctPercent: Math.round(
          (100 *
            (counts.rows.find(
              (row) =>
                row.questionId === question.questionId &&
                row.selectedOptionId === question.correctOptionId,
            )?.count ?? 0)) /
            attemptCount,
        ),
        questionId: question.questionId,
      })),
    };
  }
  if (isPublicCrosswordGame(game) && isCrosswordPublicSolutionPayload(payload)) {
    const cells = await client.query<CrosswordStatisticCellRow>(
      `select attempt.id as "attemptId", cell.cell_id::text as "cellId", cell.value
       from game_attempts attempt
       join scores score on score.attempt_id = attempt.id and score.competitive = true
       join crossword_cells cell on cell.attempt_id = attempt.id
       where attempt.game_id = $1 and attempt.status in ('accepted', 'finalized')`,
      [game.id],
    );
    const byAttempt = new Map<string, Map<string, string>>();
    for (const cell of cells.rows) {
      const attempt = byAttempt.get(cell.attemptId) ?? new Map<string, string>();
      attempt.set(cell.cellId, cell.value);
      byAttempt.set(cell.attemptId, attempt);
    }
    const answers = new Map(payload.entries.map((entry) => [entry.entryId, entry.answer]));
    return {
      crosswordEntries: game.payload.entries.map((entry) => {
        const expected = Array.from(answers.get(entry.id) ?? "");
        let correct = 0;
        for (const attempt of byAttempt.values()) {
          if (
            entry.cellIds.every(
              (cellId, index) =>
                foldCrosswordLetter(attempt.get(cellId) ?? "") ===
                foldCrosswordLetter(expected[index] ?? ""),
            )
          ) {
            correct += 1;
          }
        }
        return {
          entryId: entry.id,
          incorrectPercent: Math.round((100 * (attemptCount - correct)) / attemptCount),
        };
      }),
    };
  }
  return {};
}

async function publishSolutions(
  transaction: TransactionClient,
  editionId: string,
  now: Date,
): Promise<void> {
  await transaction.query(
    `update game_solutions solution
     set public_payload = case game.type
           when 'quiz' then jsonb_build_object(
             'kind', 'quiz-solution',
             'questions', solution.private_payload -> 'questions'
           )
           when 'crossword' then jsonb_build_object(
             'kind', 'crossword-solution',
             'entries', solution.private_payload -> 'entries'
           )
         end,
         published_at = $2,
         updated_at = $2,
         version = solution.version + 1
     from games game
     where solution.game_id = game.id
       and game.edition_id = $1
       and solution.published_at is null`,
    [editionId, now],
  );
}
