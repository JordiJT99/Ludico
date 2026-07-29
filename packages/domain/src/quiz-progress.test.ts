import {
  isPublicQuizGame,
  isQuizLocalDraft,
  type QuizAttemptState,
  type QuizProgressEvent,
  type QuizPublicPayload,
} from "@ludico/contracts";
import { describe, expect, it } from "vitest";
import {
  applyQuizEvents,
  firstUnansweredQuizQuestion,
  synchronizeQuizProgress,
} from "./quiz-progress.js";

const attempt: QuizAttemptState = {
  answers: [{ elapsedMs: 10, questionId: "q1", selectedOptionId: "old" }],
  attemptId: "attempt",
  status: "in_progress",
  version: 2,
};
const events: QuizProgressEvent[] = [
  { clientEventId: "event", elapsedMs: 20, questionId: "q1", selectedOptionId: "new" },
  { clientEventId: "event-2", elapsedMs: 30, questionId: "q2", selectedOptionId: "answer" },
];

describe("quiz progress reconciliation", () => {
  it("applies queued events in order without changing the server version", () => {
    expect(applyQuizEvents(attempt, events)).toEqual({
      ...attempt,
      answers: [
        { elapsedMs: 20, questionId: "q1", selectedOptionId: "new" },
        { elapsedMs: 30, questionId: "q2", selectedOptionId: "answer" },
      ],
    });
  });

  it("finds the first unanswered question", () => {
    const quiz = {
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    } as QuizPublicPayload;
    expect(firstUnansweredQuizQuestion(quiz, applyQuizEvents(attempt, events))).toBe(2);
  });

  it("rejects malformed public games and local drafts", () => {
    expect(isPublicQuizGame({ type: "quiz", payload: { kind: "quiz" } })).toBe(false);
    expect(isQuizLocalDraft({ gameId: "game" }, "game")).toBe(false);
  });

  it("retries queued events over the canonical conflict version", async () => {
    const versions: number[] = [];
    const synchronized = await synchronizeQuizProgress(attempt, events, async (version) => {
      versions.push(version);
      return version === 2
        ? { code: "VERSION_CONFLICT", state: { ...attempt, version: 3 } }
        : { savedEvents: events.length, status: "saved", version: 4 };
    });

    expect(versions).toEqual([2, 3]);
    expect(synchronized).toMatchObject({
      answers: [{ selectedOptionId: "new" }, { selectedOptionId: "answer" }],
      version: 4,
    });
  });
});
