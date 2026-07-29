import type { QuizPublicPayload } from "@ludico/contracts";

export const QUIZ_SCORE_VERSION = "quiz-v1";
const targetAnswerTimeMs = 20_000;

export interface QuizSolutionItem {
  readonly questionId: string;
  readonly correctOptionId: string;
  readonly explanation: string;
}

export interface QuizPrivateSolution {
  readonly kind: "quiz-solution";
  readonly questions: readonly QuizSolutionItem[];
}

export interface QuizAnswerInput {
  readonly questionId: string;
  readonly selectedOptionId: string;
  readonly elapsedMs: number;
}

export interface QuizScore {
  readonly points: number;
  readonly correctCount: number;
  readonly completed: boolean;
  readonly scoreVersion: typeof QUIZ_SCORE_VERSION;
}

export function validateQuiz(quiz: QuizPublicPayload, solution: readonly QuizSolutionItem[]): void {
  if (quiz.questions.length < 5 || quiz.questions.length > 15) {
    throw new InvalidQuizError("El quiz debe tener entre 5 y 15 preguntas");
  }
  if (solution.length !== quiz.questions.length) {
    throw new InvalidQuizError("Cada pregunta necesita exactamente una solución");
  }

  const questionIds = new Set<string>();
  for (const question of quiz.questions) {
    if (!questionIds.add(question.id)) throw new InvalidQuizError("ID de pregunta duplicado");
    if (question.options.length !== 4)
      throw new InvalidQuizError("Cada pregunta necesita 4 opciones");
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== 4) throw new InvalidQuizError("Las opciones deben ser únicas");
    const answer = solution.find((item) => item.questionId === question.id);
    if (!answer || !optionIds.has(answer.correctOptionId)) {
      throw new InvalidQuizError("La respuesta correcta debe pertenecer a sus opciones");
    }
    if (!answer.explanation.trim()) throw new InvalidQuizError("La explicación es obligatoria");
  }
}

export function calculateQuizScore(
  quiz: QuizPublicPayload,
  solution: readonly QuizSolutionItem[],
  answers: readonly QuizAnswerInput[],
): QuizScore {
  validateQuiz(quiz, solution);
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  let points = 0;
  let correctCount = 0;

  for (const question of quiz.questions) {
    const answer = answerByQuestion.get(question.id);
    const correct = solution.find((item) => item.questionId === question.id);
    if (!answer || !correct || answer.selectedOptionId !== correct.correctOptionId) continue;

    correctCount += 1;
    const multiplier = { easy: 1, medium: 1.25, hard: 1.5 }[question.difficulty];
    const elapsedMs = Math.max(0, answer.elapsedMs);
    const timeFactor = Math.max(0, 1 - elapsedMs / targetAnswerTimeMs);
    points += Math.round(100 * multiplier + 25 * multiplier * timeFactor);
  }

  const completed = quiz.questions.every((question) => answerByQuestion.has(question.id));
  if (completed) points += 100;
  return { completed, correctCount, points, scoreVersion: QUIZ_SCORE_VERSION };
}

export class InvalidQuizError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuizError";
  }
}
