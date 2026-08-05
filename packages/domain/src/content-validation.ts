import type { CrosswordPublicPayload, QuizPublicPayload } from "@ludico/contracts";
import { validateCrossword, type CrosswordPrivateSolution } from "./crossword.js";
import {
  validateGuessWord,
  validateTrueFalse,
  validateWordSearch,
  type GuessWordGame,
  type TrueFalseItem,
  type WordSearchGame,
} from "./daily-games.js";
import { validateQuizEditorial, type QuizPrivateSolution } from "./quiz.js";

export interface CandidateSource {
  readonly itemId: string;
  readonly url: string;
}

export const generatedContentTypes = [
  "crossword",
  "quiz",
  "true_false",
  "guess_word",
  "word_search",
] as const;

export type GeneratedContentType = (typeof generatedContentTypes)[number];

type TrueFalsePublicPayload = {
  readonly items: readonly {
    readonly category: string;
    readonly difficulty: 1 | 2 | 3 | 4 | 5;
    readonly id: string;
    readonly statement: string;
  }[];
  readonly kind: "true-false";
  readonly title: string;
};
type TrueFalsePrivatePayload = {
  readonly items: readonly {
    readonly explanation: string;
    readonly id: string;
    readonly value: boolean;
  }[];
  readonly kind: "true-false-solution";
};
type GuessWordPublicPayload = {
  readonly allowedCharacters: readonly string[];
  readonly category: string;
  readonly definition: string;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly hints: readonly { readonly text: string; readonly unlockAfterAttempts: number }[];
  readonly id: string;
  readonly kind: "guess-word";
  readonly maxAttempts: number;
  readonly title: string;
};
type GuessWordPrivatePayload = {
  readonly alternativeAnswers: readonly string[];
  readonly answer: string;
  readonly kind: "guess-word-solution";
};
type WordSearchPublicPayload = {
  readonly columns: number;
  readonly difficulty: 1 | 2 | 3 | 4 | 5;
  readonly grid: readonly (readonly string[])[];
  readonly kind: "word-search";
  readonly rows: number;
  readonly seed: string;
  readonly title: string;
  readonly words: readonly { readonly answer: string; readonly id: string }[];
};
type WordSearchPrivatePayload = {
  readonly entries: WordSearchGame["entries"];
  readonly kind: "word-search-solution";
};

export type GeneratedContentCandidate =
  | {
      readonly type: "crossword";
      readonly publicPayload: CrosswordPublicPayload;
      readonly privatePayload: CrosswordPrivateSolution;
      readonly sources: readonly CandidateSource[];
    }
  | {
      readonly type: "true_false";
      readonly publicPayload: TrueFalsePublicPayload;
      readonly privatePayload: TrueFalsePrivatePayload;
      readonly sources: readonly CandidateSource[];
    }
  | {
      readonly type: "guess_word";
      readonly publicPayload: GuessWordPublicPayload;
      readonly privatePayload: GuessWordPrivatePayload;
      readonly sources: readonly CandidateSource[];
    }
  | {
      readonly type: "word_search";
      readonly publicPayload: WordSearchPublicPayload;
      readonly privatePayload: WordSearchPrivatePayload;
      readonly sources: readonly CandidateSource[];
    }
  | {
      readonly type: "quiz";
      readonly publicPayload: QuizPublicPayload;
      readonly privatePayload: QuizPrivateSolution;
      readonly sources: readonly CandidateSource[];
    };

export type ContentFindingCode =
  | "BLOCKED_TERM"
  | "DIFFICULTY_MISMATCH"
  | "DUPLICATE_CONTENT"
  | "SEMANTIC_DUPLICATE"
  | "HIGH_RISK_REVIEW"
  | "INVALID_SOURCE"
  | "INVALID_STRUCTURE"
  | "MISSING_SOURCE"
  | "SOURCE_UNVERIFIED"
  | "EVALUATOR_REVIEW";

export interface ContentFinding {
  readonly code: ContentFindingCode;
  readonly itemId?: string;
}

export interface ContentValidation {
  readonly canonicalContent: string;
  readonly findings: readonly ContentFinding[];
  readonly status: "rejected" | "review" | "valid";
}

const highRiskTerms = ["diagnóstico", "inversión", "medicamento", "política", "síntoma"];

export function validateGeneratedContent(
  candidate: GeneratedContentCandidate,
  options: Readonly<{
    blockedTerms?: readonly string[];
    knownCanonicalContents?: ReadonlySet<string>;
    knownSemanticCandidates?: readonly GeneratedContentCandidate[];
    targetDifficulty?: 1 | 2 | 3 | 4 | 5;
  }> = {},
): ContentValidation {
  const findings: ContentFinding[] = [];
  try {
    validateCandidateStructure(candidate);
  } catch {
    findings.push({ code: "INVALID_STRUCTURE" });
  }
  if (
    options.targetDifficulty !== undefined &&
    !matchesTargetDifficulty(candidate, options.targetDifficulty)
  ) {
    findings.push({ code: "DIFFICULTY_MISMATCH" });
  }

  const requiredItemIds = candidateItemIds(candidate);
  const sourcesByItem = new Map<string, number>();
  for (const source of candidate.sources) {
    sourcesByItem.set(source.itemId, (sourcesByItem.get(source.itemId) ?? 0) + 1);
    if (!isSafeSource(source.url) || !requiredItemIds.includes(source.itemId)) {
      findings.push({ code: "INVALID_SOURCE", itemId: source.itemId });
    }
  }
  for (const itemId of requiredItemIds) {
    if (!sourcesByItem.has(itemId)) findings.push({ code: "MISSING_SOURCE", itemId });
  }

  const searchable = contentText(candidate).map(normalizeSearchText);
  if (
    (options.blockedTerms ?? []).some((term) => {
      const normalized = normalizeSearchText(term);
      return normalized.length > 0 && searchable.some((text) => text.includes(normalized));
    })
  ) {
    findings.push({ code: "BLOCKED_TERM" });
  }
  if (
    highRiskTerms.some((term) =>
      searchable.some((text) => text.includes(normalizeSearchText(term))),
    )
  ) {
    findings.push({ code: "HIGH_RISK_REVIEW" });
  }

  const canonicalContent = canonicalJson({
    privatePayload: candidate.privatePayload,
    publicPayload: candidate.publicPayload,
    type: candidate.type,
  });
  if (options.knownCanonicalContents?.has(canonicalContent)) {
    findings.push({ code: "DUPLICATE_CONTENT" });
  }
  if (
    options.knownSemanticCandidates?.some(
      (known) =>
        known.type === candidate.type && semanticContentSimilarity(candidate, known) >= 0.82,
    )
  ) {
    findings.push({ code: "SEMANTIC_DUPLICATE" });
  }

  const rejected = findings.some((finding) => finding.code !== "HIGH_RISK_REVIEW");
  return {
    canonicalContent,
    findings,
    status: rejected
      ? "rejected"
      : findings.some((finding) => finding.code === "HIGH_RISK_REVIEW")
        ? "review"
        : "valid",
  };
}

function matchesTargetDifficulty(
  candidate: GeneratedContentCandidate,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
): boolean {
  if (candidate.type === "quiz") {
    return candidate.publicPayload.questions.every(
      (question) =>
        ({ very_easy: 1, easy: 2, medium: 3, hard: 4, expert: 5 })[question.difficulty] ===
        targetDifficulty,
    );
  }
  if (candidate.type === "true_false")
    return candidate.publicPayload.items.every((item) => item.difficulty === targetDifficulty);
  return candidate.publicPayload.difficulty === targetDifficulty;
}

export function semanticContentSimilarity(
  left: GeneratedContentCandidate,
  right: GeneratedContentCandidate,
): number {
  if (left.type !== right.type) return 0;
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  if (leftTokens.size < 6 || rightTokens.size < 6) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function contentText(candidate: GeneratedContentCandidate): string[] {
  if (candidate.type === "quiz") {
    return [
      candidate.publicPayload.title,
      ...candidate.publicPayload.questions.flatMap((question) => [
        question.prompt,
        question.category,
        ...question.options.map((option) => option.text),
      ]),
      ...candidate.privatePayload.questions.map((question) => question.explanation),
    ];
  }
  if (candidate.type === "crossword") {
    return [
      candidate.publicPayload.title,
      ...candidate.publicPayload.entries.map((entry) => entry.clue),
      ...candidate.privatePayload.entries.map((entry) => entry.answer),
    ];
  }
  if (candidate.type === "true_false") {
    return [
      candidate.publicPayload.title,
      ...candidate.publicPayload.items.map((item) => item.statement),
      ...candidate.privatePayload.items.map((item) => item.explanation),
    ];
  }
  if (candidate.type === "guess_word") {
    return [
      candidate.publicPayload.title,
      candidate.publicPayload.definition,
      ...candidate.publicPayload.hints.map((hint) => hint.text),
      candidate.privatePayload.answer,
    ];
  }
  return [
    candidate.publicPayload.title,
    ...candidate.publicPayload.words.map((word) => word.answer),
  ];
}

function validateCandidateStructure(candidate: GeneratedContentCandidate): void {
  if (candidate.type === "quiz") {
    validateQuizEditorial(candidate.publicPayload, candidate.privatePayload.questions);
    return;
  }
  if (candidate.type === "crossword") {
    validateCrossword(candidate.publicPayload, candidate.privatePayload);
    return;
  }
  if (candidate.type === "true_false") {
    const privateById = new Map(candidate.privatePayload.items.map((item) => [item.id, item]));
    if (privateById.size !== candidate.publicPayload.items.length)
      throw new Error("INVALID_TRUE_FALSE");
    const items: TrueFalseItem[] = candidate.publicPayload.items.map((item) => {
      const solution = privateById.get(item.id);
      if (!solution) throw new Error("INVALID_TRUE_FALSE");
      return {
        ...item,
        explanation: solution.explanation,
        sourceUrl: "https://content.local/source",
        value: solution.value,
      };
    });
    validateTrueFalse(items);
    return;
  }
  if (candidate.type === "guess_word") {
    const game: GuessWordGame = { ...candidate.publicPayload, ...candidate.privatePayload };
    validateGuessWord(game);
    return;
  }
  const answers = new Set(candidate.publicPayload.words.map((word) => word.answer));
  if (
    answers.size !== candidate.publicPayload.words.length ||
    candidate.privatePayload.entries.length !== candidate.publicPayload.words.length ||
    candidate.privatePayload.entries.some(
      (entry, index) => candidate.publicPayload.words[index]?.answer !== entry.answer,
    )
  ) {
    throw new Error("INVALID_WORD_SEARCH");
  }
  validateWordSearch({
    columns: candidate.publicPayload.columns,
    entries: candidate.privatePayload.entries,
    grid: candidate.publicPayload.grid,
    rows: candidate.publicPayload.rows,
    seed: candidate.publicPayload.seed,
  });
}

function candidateItemIds(candidate: GeneratedContentCandidate): readonly string[] {
  if (candidate.type === "quiz")
    return candidate.publicPayload.questions.map((question) => question.id);
  if (candidate.type === "crossword")
    return candidate.publicPayload.entries.map((entry) => entry.id);
  if (candidate.type === "true_false") return candidate.publicPayload.items.map((item) => item.id);
  if (candidate.type === "guess_word") return [candidate.publicPayload.id];
  return candidate.publicPayload.words.map((word) => word.id);
}

function isSafeSource(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-ES");
}

const semanticStopWords = new Set(["con", "del", "las", "los", "para", "por", "que", "una", "uno"]);

function semanticTokens(candidate: GeneratedContentCandidate): Set<string> {
  return new Set(
    contentText(candidate)
      .join(" ")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("es-ES")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3 && !semanticStopWords.has(token)),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
