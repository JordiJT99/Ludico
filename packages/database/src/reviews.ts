import type {
  AttemptReview,
  CrosswordAttemptCell,
  GuessWordAttempt,
  QuizAttemptAnswer,
} from "@ludico/contracts";
import type { QueryResultRow } from "pg";
import { getGameSolution } from "./editions.js";
import { authenticateGuestSession, GuestTokenError } from "./guests.js";
import type { SqlClient, TransactionClient } from "./sql-client.js";

interface ReviewRow extends QueryResultRow {
  competitive: boolean;
  gameId: string;
  points: number;
  scoreVersion: string;
  submittedAt: Date | string;
  type: "quiz" | "crossword" | "true_false" | "guess_word";
}

export type AttemptReviewResult =
  { status: "available"; review: AttemptReview } | { status: "locked" | "not_found" };

export async function getGuestAttemptReview(
  client: SqlClient,
  attemptId: string,
  guestToken: string,
  now: Date,
): Promise<AttemptReviewResult> {
  return client.transaction(async (transaction) => {
    const guest = await authenticateGuestSession(transaction, guestToken, now);
    if (!guest) throw new GuestTokenError();
    return getAttemptReview(transaction, attemptId, "guest_session_id", guest.guestSessionId, now);
  });
}

export async function getUserAttemptReview(
  client: SqlClient,
  attemptId: string,
  userId: string,
  now: Date,
): Promise<AttemptReviewResult> {
  return client.transaction((transaction) =>
    getAttemptReview(transaction, attemptId, "user_id", userId, now),
  );
}

async function getAttemptReview(
  transaction: TransactionClient,
  attemptId: string,
  subjectColumn: "guest_session_id" | "user_id",
  subjectId: string,
  now: Date,
): Promise<AttemptReviewResult> {
  const result = await transaction.query<ReviewRow>(
    `select attempt.game_id as "gameId", game.type, attempt.submitted_at as "submittedAt",
            score.points, score.score_version as "scoreVersion", score.competitive
     from game_attempts attempt
     join games game on game.id = attempt.game_id
     join scores score on score.attempt_id = attempt.id
     where attempt.id = $1 and attempt.${subjectColumn} = $2
       and attempt.status in ('accepted', 'finalized')
     limit 1`,
    [attemptId, subjectId],
  );
  const row = result.rows[0];
  if (!row) return { status: "not_found" };
  const published = await getGameSolution(transaction, row.gameId, now);
  if (published.status !== "available") return { status: published.status };

  const progress =
    row.type === "quiz" || row.type === "true_false"
      ? {
          answers: (
            await transaction.query<QuizAttemptAnswer & QueryResultRow>(
              `select question_id as "questionId", selected_option_id as "selectedOptionId",
                      elapsed_ms as "elapsedMs"
               from answers where attempt_id = $1 order by created_at`,
              [attemptId],
            )
          ).rows,
          kind: "quiz-progress" as const,
        }
      : row.type === "guess_word"
        ? {
            guesses: (
              await transaction.query<GuessWordAttempt & QueryResultRow>(
                `select guess, elapsed_ms as "elapsedMs" from word_guesses
                 where attempt_id = $1 order by created_at`,
                [attemptId],
              )
            ).rows,
            kind: "guess-word-progress" as const,
          }
        : {
            cells: (
              await transaction.query<CrosswordAttemptCell & QueryResultRow>(
                `select cell_id as "cellId", value, elapsed_ms as "elapsedMs"
               from crossword_cells where attempt_id = $1 order by created_at`,
                [attemptId],
              )
            ).rows,
            hintsUsed: Number(
              (
                await transaction.query<{ count: string } & QueryResultRow>(
                  `select count(*)::text as count from attempt_events
                 where attempt_id = $1 and event_type = 'hint_revealed'`,
                  [attemptId],
                )
              ).rows[0]?.count ?? 0,
            ),
            kind: "crossword-progress" as const,
          };

  return {
    review: {
      attemptId,
      progress,
      score: {
        competitive: row.competitive,
        points: row.points,
        scoreVersion: row.scoreVersion,
      },
      solution: published.solution,
      submittedAt: new Date(row.submittedAt).toISOString(),
    },
    status: "available",
  };
}
