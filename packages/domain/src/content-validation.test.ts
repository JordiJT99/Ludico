import type { QuizPublicPayload } from "@ludico/contracts";
import { describe, expect, it } from "vitest";
import { validateGeneratedContent, type GeneratedContentCandidate } from "./content-validation.js";

describe("generated content validation", () => {
  it("accepts a sourced quiz and produces the same canonical content for reordered keys", () => {
    const candidate = quizCandidate();
    const first = validateGeneratedContent(candidate);
    const reordered = validateGeneratedContent({
      sources: candidate.sources,
      privatePayload: candidate.privatePayload,
      publicPayload: candidate.publicPayload,
      type: "quiz",
    });
    expect(first.status).toBe("valid");
    expect(first.findings).toEqual([]);
    expect(reordered.canonicalContent).toBe(first.canonicalContent);
  });

  it("rejects missing sources, unsafe URLs, blocked terms and exact duplicates", () => {
    const candidate = quizCandidate();
    const invalid = {
      ...candidate,
      publicPayload: { ...candidate.publicPayload, title: "Tema prohibido" },
      sources: [{ itemId: candidate.publicPayload.questions[0]!.id, url: "http://example.com" }],
    };
    const canonical = validateGeneratedContent(invalid).canonicalContent;
    const result = validateGeneratedContent(invalid, {
      blockedTerms: ["prohibido"],
      knownCanonicalContents: new Set([canonical]),
    });
    expect(result.status).toBe("rejected");
    expect(result.findings.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "BLOCKED_TERM",
        "DUPLICATE_CONTENT",
        "INVALID_SOURCE",
        "MISSING_SOURCE",
      ]),
    );
  });

  it("routes medically sensitive content to review instead of auto-validating it", () => {
    const candidate = quizCandidate();
    const result = validateGeneratedContent({
      ...candidate,
      publicPayload: { ...candidate.publicPayload, title: "Historia del diagnóstico médico" },
    });
    expect(result.status).toBe("review");
    expect(result.findings).toEqual([{ code: "HIGH_RISK_REVIEW" }]);
  });

  it("rejects a near-duplicate after deterministic token similarity", () => {
    const original = quizCandidate();
    const nearDuplicate: GeneratedContentCandidate = {
      ...original,
      publicPayload: {
        ...original.publicPayload,
        title: "Quiz cultural de prueba",
        questions: original.publicPayload.questions.map((question, index) =>
          index === 0 ? { ...question, prompt: "Pregunta cultural 1" } : question,
        ),
      },
    };
    const result = validateGeneratedContent(nearDuplicate, {
      knownSemanticCandidates: [original],
    });
    expect(result.status).toBe("rejected");
    expect(result.findings).toContainEqual({ code: "SEMANTIC_DUPLICATE" });
  });
});

function quizCandidate(): GeneratedContentCandidate {
  const questions: QuizPublicPayload["questions"] = Array.from({ length: 5 }, (_, index) => {
    const questionId = `40000000-0000-4000-8000-00000000000${index}`;
    return {
      id: questionId,
      prompt: `Pregunta ${index + 1}`,
      category: "Cultura",
      difficulty: "easy" as const,
      options: Array.from({ length: 4 }, (_, option) => ({
        id: `50000000-0000-4000-8000-0000000000${index}${option}`,
        text: `Opción ${option + 1}`,
      })),
    };
  });
  return {
    type: "quiz",
    publicPayload: { kind: "quiz", questions, title: "Quiz de prueba" },
    privatePayload: {
      kind: "quiz-solution",
      questions: questions.map((question) => ({
        correctOptionId: question.options[questions.indexOf(question) % 4]!.id,
        explanation: "Explicación contrastada.",
        questionId: question.id,
      })),
    },
    sources: questions.map((question) => ({
      itemId: question.id,
      url: `https://example.com/${question.id}`,
    })),
  };
}
