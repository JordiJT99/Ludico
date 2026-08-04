import type { QuizPublicPayload } from "@ludico/contracts";
import { describe, expect, it } from "vitest";
import {
  calculateQuizScore,
  InvalidQuizError,
  type QuizAnswerInput,
  type QuizSolutionItem,
  validateQuiz,
  validateQuizEditorial,
} from "./quiz.js";

const quiz: QuizPublicPayload = {
  kind: "quiz",
  title: "Prueba",
  questions: Array.from({ length: 5 }, (_, questionIndex) => ({
    id: `00000000-0000-4000-8000-00000000000${questionIndex}`,
    prompt: `Pregunta ${questionIndex + 1}`,
    category: "General",
    difficulty: questionIndex === 0 ? "easy" : questionIndex === 1 ? "medium" : "hard",
    options: Array.from({ length: 4 }, (_, optionIndex) => ({
      id: `10000000-0000-4000-8000-0000000000${questionIndex}${optionIndex}`,
      text: `Opción ${optionIndex + 1}`,
    })),
  })),
};

const solution: QuizSolutionItem[] = quiz.questions.map((question) => ({
  questionId: question.id,
  correctOptionId: question.options[0]!.id,
  explanation: "Explicación verificada",
}));

describe("quiz validation", () => {
  it("requires one valid solution per question", () => {
    expect(() => validateQuiz(quiz, solution)).not.toThrow();
    expect(() => validateQuiz(quiz, solution.slice(1))).toThrow(InvalidQuizError);
  });

  it("validates binary true-false questions only with explicit binary rules", () => {
    const binaryQuiz: QuizPublicPayload = {
      ...quiz,
      questions: quiz.questions.slice(0, 3).map((question) => ({
        ...question,
        options: question.options.slice(0, 2),
      })),
    };
    const binarySolution = binaryQuiz.questions.map((question) => ({
      correctOptionId: question.options[0]!.id,
      explanation: "Explicacion binaria verificada.",
      questionId: question.id,
    }));
    expect(() => validateQuiz(binaryQuiz, binarySolution)).toThrow(InvalidQuizError);
    expect(() =>
      validateQuiz(binaryQuiz, binarySolution, {
        maxQuestions: 20,
        minQuestions: 3,
        optionCount: 2,
      }),
    ).not.toThrow();
    expect(
      calculateQuizScore(binaryQuiz, binarySolution, [], {
        maxQuestions: 20,
        minQuestions: 3,
        optionCount: 2,
      }),
    ).toMatchObject({ completed: false, points: 0 });
  });

  it("rejects repeated editorial text and predictable correct-answer positions", () => {
    expect(() => validateQuizEditorial(quiz, solution)).toThrow(InvalidQuizError);
    const balanced = solution.map((item, index) => ({
      ...item,
      correctOptionId: quiz.questions[index]!.options[index % 4]!.id,
    }));
    expect(() => validateQuizEditorial(quiz, balanced)).not.toThrow();
    expect(() =>
      validateQuizEditorial(
        {
          ...quiz,
          questions: quiz.questions.map((question, index) =>
            index === 1 ? { ...question, prompt: quiz.questions[0]!.prompt } : question,
          ),
        },
        balanced,
      ),
    ).toThrow(InvalidQuizError);
  });
});

describe("quiz score v1", () => {
  it("rewards correct answers, difficulty, time and completion", () => {
    const answers: QuizAnswerInput[] = quiz.questions.map((question, index) => ({
      questionId: question.id,
      selectedOptionId: question.options[0]!.id,
      elapsedMs: index === 0 ? 0 : 20_000,
    }));

    expect(calculateQuizScore(quiz, solution, answers)).toEqual({
      completed: true,
      correctCount: 5,
      points: 800,
      scoreVersion: "quiz-v1",
    });
  });

  it("does not award speed points to an incorrect answer", () => {
    const result = calculateQuizScore(quiz, solution, [
      {
        questionId: quiz.questions[0]!.id,
        selectedOptionId: quiz.questions[0]!.options[1]!.id,
        elapsedMs: 0,
      },
    ]);

    expect(result).toMatchObject({ completed: false, correctCount: 0, points: 0 });
  });
});
