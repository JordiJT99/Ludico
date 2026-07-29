import type { QuizPublicPayload } from "@ludico/contracts";
import { constructCrossword, type WordBankEntry } from "@ludico/domain";
import type { ContentAssurancePort, ContentGeneratorPort } from "./content-jobs.js";

export const fakeContentAssurance: ContentAssurancePort = {
  async evaluate() {
    return true;
  },
  async verifySources() {
    return true;
  },
};

export const fakeContentGenerator: ContentGeneratorPort = {
  async generate(job) {
    return {
      candidate:
        job.contentType === "quiz" ? fakeQuiz(job.targetDate) : fakeCrossword(job.targetDate),
      costMicros: 0,
    };
  },
};

function fakeQuiz(targetDate: string) {
  const questions: QuizPublicPayload["questions"] = Array.from({ length: 5 }, (_, index) => ({
    id: uuid(targetDate, 100 + index),
    prompt: `Pregunta sintética ${index + 1} para ${targetDate}`,
    category: "Prueba",
    difficulty: "easy" as const,
    options: Array.from({ length: 4 }, (_, option) => ({
      id: uuid(targetDate, 200 + index * 4 + option),
      text: `Opción ${option + 1}`,
    })),
  }));
  return {
    type: "quiz" as const,
    publicPayload: { kind: "quiz" as const, questions, title: `Quiz sintético ${targetDate}` },
    privatePayload: {
      kind: "quiz-solution" as const,
      questions: questions.map((question) => ({
        correctOptionId: question.options[0]!.id,
        explanation: "Contenido exclusivo para desarrollo y pruebas.",
        questionId: question.id,
      })),
    },
    sources: questions.map((question) => ({
      itemId: question.id,
      url: `https://example.com/test/${question.id}`,
    })),
  };
}

function fakeCrossword(targetDate: string) {
  return constructCrossword(fakeWordBank, {
    entryCount: 3,
    seed: targetDate,
    title: `Crucigrama sintético ${targetDate}`,
    vocabularyVersion: "fake-v1",
  });
}

const fakeWordBank: readonly WordBankEntry[] = [
  word("sol", "SOL", "Astro de prueba"),
  word("sal", "SAL", "Condimento de prueba"),
  word("luz", "LUZ", "Claridad de prueba"),
  word("sur", "SUR", "Punto cardinal de prueba"),
  word("riel", "RIEL", "Barra de vía de prueba"),
];

function word(id: string, answer: string, clue: string): WordBankEntry {
  return { answer, clue, id, sourceUrl: `https://example.com/test/dictionary/${id}` };
}

function uuid(targetDate: string, suffix: number): string {
  const date = targetDate.replaceAll("-", "").padEnd(12, "0").slice(0, 12);
  return `${date.slice(0, 8)}-${date.slice(8, 12)}-4000-8000-${suffix.toString().padStart(12, "0")}`;
}
