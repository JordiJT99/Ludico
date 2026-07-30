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
  const solutionQuestionIds = new Set<string>();
  for (const question of quiz.questions) {
    if (questionIds.has(question.id)) throw new InvalidQuizError("ID de pregunta duplicado");
    questionIds.add(question.id);
    if (question.options.length !== 4)
      throw new InvalidQuizError("Cada pregunta necesita 4 opciones");
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== 4) throw new InvalidQuizError("Las opciones deben ser únicas");
    const answer = solution.find((item) => item.questionId === question.id);
    if (
      !answer ||
      solutionQuestionIds.has(answer.questionId) ||
      !optionIds.has(answer.correctOptionId)
    ) {
      throw new InvalidQuizError("La respuesta correcta debe pertenecer a sus opciones");
    }
    solutionQuestionIds.add(answer.questionId);
    if (!answer.explanation.trim()) throw new InvalidQuizError("La explicación es obligatoria");
  }
}

export function validateQuizEditorial(
  quiz: QuizPublicPayload,
  solution: readonly QuizSolutionItem[],
): void {
  validateQuiz(quiz, solution);
  const prompts = new Set<string>();
  const correctPositions = [0, 0, 0, 0];
  for (const question of quiz.questions) {
    const prompt = normalizeEditorialText(question.prompt);
    if (prompts.has(prompt)) {
      throw new InvalidQuizError("Las preguntas no pueden repetirse");
    }
    prompts.add(prompt);
    const optionTexts = new Set(
      question.options.map((option) => normalizeEditorialText(option.text)),
    );
    if (optionTexts.size !== question.options.length) {
      throw new InvalidQuizError("Las opciones no pueden repetirse");
    }
    const answer = solution.find((item) => item.questionId === question.id)!;
    const position = question.options.findIndex((option) => option.id === answer.correctOptionId);
    correctPositions[position]! += 1;
  }
  const maximumPerPosition = Math.ceil(quiz.questions.length / 4) + 1;
  if (correctPositions.some((count) => count > maximumPerPosition)) {
    throw new InvalidQuizError("La posiciÃ³n de respuesta correcta estÃ¡ desequilibrada");
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
    const multiplier = {
      very_easy: 0.85,
      easy: 1,
      medium: 1.25,
      hard: 1.5,
      expert: 1.8,
    }[question.difficulty];
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

function normalizeEditorialText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim()
    .replace(/\s+/g, " ");
}
