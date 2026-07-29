import type { CrosswordPublicPayload, QuizPublicPayload } from "@ludico/contracts";
import { validateCrossword, type CrosswordPrivateSolution } from "./crossword.js";
import { validateQuiz, type QuizPrivateSolution } from "./quiz.js";

export interface CandidateSource {
  readonly itemId: string;
  readonly url: string;
}

export type GeneratedContentCandidate =
  | {
      readonly type: "crossword";
      readonly publicPayload: CrosswordPublicPayload;
      readonly privatePayload: CrosswordPrivateSolution;
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
  }> = {},
): ContentValidation {
  const findings: ContentFinding[] = [];
  try {
    if (candidate.type === "quiz") {
      validateQuiz(candidate.publicPayload, candidate.privatePayload.questions);
    } else {
      validateCrossword(candidate.publicPayload, candidate.privatePayload);
    }
  } catch {
    findings.push({ code: "INVALID_STRUCTURE" });
  }

  const requiredItemIds =
    candidate.type === "quiz"
      ? candidate.publicPayload.questions.map((question) => question.id)
      : candidate.publicPayload.entries.map((entry) => entry.id);
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
  return [
    candidate.publicPayload.title,
    ...candidate.publicPayload.entries.map((entry) => entry.clue),
    ...candidate.privatePayload.entries.map((entry) => entry.answer),
  ];
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
