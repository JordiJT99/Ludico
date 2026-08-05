import type { QuizPublicPayload } from "@ludico/contracts";
import {
  constructCrossword,
  constructWordSearch,
  type GeneratedContentCandidate,
  type WordBankEntry,
} from "@ludico/domain";
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
      candidate: fakeCandidate(job.contentType, job.targetDate, job.promptVersion),
      costMicros: 0,
    };
  },
};

function fakeCandidate(
  type: GeneratedContentCandidate["type"],
  targetDate: string,
  promptVersion: string,
) {
  switch (type) {
    case "quiz":
      return fakeQuiz(targetDate, promptVersion);
    case "crossword":
      return fakeCrossword(targetDate, promptVersion);
    case "true_false":
      return fakeTrueFalse(targetDate, promptVersion);
    case "guess_word":
      return fakeGuessWord(targetDate, promptVersion);
    case "word_search":
      return fakeWordSearch(targetDate, promptVersion);
  }
}

function fakeQuiz(targetDate: string, promptVersion: string) {
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
    publicPayload: {
      kind: "quiz" as const,
      questions,
      title: `Quiz sintético ${label(targetDate, promptVersion)}`,
    },
    privatePayload: {
      kind: "quiz-solution" as const,
      questions: questions.map((question) => ({
        correctOptionId: question.options[questions.indexOf(question) % 4]!.id,
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

function fakeCrossword(targetDate: string, promptVersion: string) {
  return constructCrossword(fakeWordBank, {
    entryCount: 3,
    seed: label(targetDate, promptVersion),
    title: `Crucigrama sintético ${label(targetDate, promptVersion)}`,
    vocabularyVersion: "fake-v1",
  });
}

function fakeTrueFalse(targetDate: string, promptVersion: string): GeneratedContentCandidate {
  const items = [
    ["La Tierra gira alrededor del Sol.", true],
    ["La Luna es un planeta.", false],
    ["El agua esta formada por hidrogeno y oxigeno.", true],
    ["Los murcielagos son mamiferos.", true],
    ["El Sol gira alrededor de la Tierra.", false],
  ] as const;
  return {
    type: "true_false",
    publicPayload: {
      items: items.map(([statement], index) => ({
        category: "Ciencia",
        difficulty: 1 as const,
        id: uuid(targetDate, 300 + index),
        statement,
      })),
      kind: "true-false",
      title: `Verdadero o falso ${label(targetDate, promptVersion)}`,
    },
    privatePayload: {
      items: items.map(([, value], index) => ({
        explanation: "Contenido determinista para desarrollo y pruebas.",
        id: uuid(targetDate, 300 + index),
        value,
      })),
      kind: "true-false-solution",
    },
    sources: items.map((_, index) => ({
      itemId: uuid(targetDate, 300 + index),
      url: `https://example.com/test/true-false/${index}`,
    })),
  };
}

function fakeGuessWord(targetDate: string, promptVersion: string): GeneratedContentCandidate {
  const id = uuid(targetDate, 400);
  return {
    type: "guess_word",
    publicPayload: {
      allowedCharacters: ["A", "R", "B", "O", "L"],
      category: "Naturaleza",
      definition: "Planta leñosa con tronco y copa.",
      difficulty: 2,
      hints: [{ text: "Tiene raices.", unlockAfterAttempts: 1 }],
      id,
      kind: "guess-word",
      maxAttempts: 5,
      title: `Adivina la palabra ${label(targetDate, promptVersion)}`,
    },
    privatePayload: { alternativeAnswers: [], answer: "ARBOL", kind: "guess-word-solution" },
    sources: [{ itemId: id, url: "https://example.com/test/guess-word/arbol" }],
  };
}

function fakeWordSearch(targetDate: string, promptVersion: string): GeneratedContentCandidate {
  const game = constructWordSearch({
    columns: 8,
    directions: ["east", "south", "southEast"],
    rows: 8,
    seed: label(targetDate, promptVersion),
    words: ["SOL", "LUNA", "NUBE"],
  });
  return {
    type: "word_search",
    publicPayload: {
      columns: game.columns,
      grid: game.grid,
      kind: "word-search",
      rows: game.rows,
      seed: game.seed,
      title: `Sopa de letras ${label(targetDate, promptVersion)}`,
      words: game.entries.map((entry, index) => ({
        answer: entry.answer,
        id: uuid(targetDate, 500 + index),
      })),
    },
    privatePayload: { entries: game.entries, kind: "word-search-solution" },
    sources: game.entries.map((_, index) => ({
      itemId: uuid(targetDate, 500 + index),
      url: `https://example.com/test/word-search/${index}`,
    })),
  };
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

function label(targetDate: string, promptVersion: string): string {
  return promptVersion === "v1" ? targetDate : `${targetDate} ${promptVersion}`;
}
