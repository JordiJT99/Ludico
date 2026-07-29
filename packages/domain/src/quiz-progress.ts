import type {
  QuizAttemptState,
  QuizProgressEvent,
  QuizProgressResponse,
  QuizPublicPayload,
} from "@ludico/contracts";

export function applyQuizEvents(
  attempt: QuizAttemptState,
  events: readonly QuizProgressEvent[],
): QuizAttemptState {
  const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
  for (const { questionId, selectedOptionId, elapsedMs } of events) {
    answers.set(questionId, { elapsedMs, questionId, selectedOptionId });
  }
  return { ...attempt, answers: [...answers.values()] };
}

export function firstUnansweredQuizQuestion(
  quiz: QuizPublicPayload,
  attempt: QuizAttemptState,
): number {
  const answered = new Set(attempt.answers.map((answer) => answer.questionId));
  const index = quiz.questions.findIndex((question) => !answered.has(question.id));
  return index < 0 ? 0 : index;
}

export async function synchronizeQuizProgress(
  attempt: QuizAttemptState,
  events: readonly QuizProgressEvent[],
  save: (version: number, events: readonly QuizProgressEvent[]) => Promise<QuizProgressResponse>,
): Promise<QuizAttemptState> {
  let current = attempt;
  for (let tryNumber = 0; tryNumber < 2; tryNumber += 1) {
    const result = await save(current.version, events);
    if ("status" in result) {
      return { ...applyQuizEvents(current, events), version: result.version };
    }
    current = applyQuizEvents(result.state, events);
  }
  throw new Error("No se pudo resolver el conflicto de progreso");
}
