import { isQuizPublicPayload, isWordSearchPublicPayload } from "@ludico/contracts";
import { validateGeneratedContent } from "@ludico/domain";
import { describe, expect, it } from "vitest";
import {
  deterministicContentAssurance,
  deterministicContentGenerator,
} from "./fake-content-generator.js";

describe("curated deterministic content provider", () => {
  it.each(["quiz", "crossword", "true_false", "guess_word", "word_search"] as const)(
    "generates valid rotating %s content without an external provider",
    async (type) => {
      for (const targetDate of reserveHorizon()) {
        const generated = await deterministicContentGenerator.generate({
          budgetMicros: 0,
          contentType: type,
          id: `job-${type}-${targetDate}`,
          promptVersion: "v1",
          provider: "deterministic",
          targetDifficulty: targetDifficulty(type),
          targetDate,
        });
        expect(generated.costMicros).toBe(0);
        expect(validateGeneratedContent(generated.candidate)).toMatchObject({ status: "valid" });
        await expect(
          deterministicContentAssurance.verifySources(generated.candidate),
        ).resolves.toBe(true);
        await expect(deterministicContentAssurance.evaluate(generated.candidate)).resolves.toBe(
          true,
        );
      }
    },
  );

  it("rotates playable content across dates instead of serving the same fixture", async () => {
    const first = await deterministicContentGenerator.generate({
      budgetMicros: 0,
      contentType: "quiz",
      id: "first",
      promptVersion: "v1",
      provider: "deterministic",
      targetDifficulty: 2,
      targetDate: "2026-08-03",
    });
    const next = await deterministicContentGenerator.generate({
      budgetMicros: 0,
      contentType: "quiz",
      id: "next",
      promptVersion: "v1",
      provider: "deterministic",
      targetDifficulty: 2,
      targetDate: "2026-08-04",
    });
    if (first.candidate.type !== "quiz" || next.candidate.type !== "quiz") throw new Error("quiz");
    expect(first.candidate.publicPayload.questions.map(({ prompt }) => prompt)).not.toEqual(
      next.candidate.publicPayload.questions.map(({ prompt }) => prompt),
    );
  });

  it("keeps the very-easy guess-word reserve free of repeated answers for fourteen days", async () => {
    const answers = await Promise.all(
      reserveHorizon().slice(0, 14).map(async (targetDate) => {
        const generated = await deterministicContentGenerator.generate({
          budgetMicros: 0,
          contentType: "guess_word",
          id: `guess-${targetDate}`,
          promptVersion: "v1",
          provider: "deterministic",
          targetDifficulty: 1,
          targetDate,
        });
        if (generated.candidate.type !== "guess_word") throw new Error("guess_word");
        return generated.candidate.privatePayload.answer;
      }),
    );
    expect(new Set(answers)).toHaveLength(14);
  });

  it("keeps the word-search reserve free of repeated words for fourteen days", async () => {
    const answers = (
      await Promise.all(
        reserveHorizon().slice(0, 14).map(async (targetDate) => {
          const generated = await deterministicContentGenerator.generate({
            budgetMicros: 0,
            contentType: "word_search",
            id: `word-search-${targetDate}`,
            promptVersion: "v1",
            provider: "deterministic",
            targetDifficulty: 2,
            targetDate,
          });
          if (generated.candidate.type !== "word_search") throw new Error("word_search");
          return generated.candidate.publicPayload.words.map((word) => word.answer);
        }),
      )
    ).flat();
    expect(new Set(answers)).toHaveLength(70);
  });

  it("keeps the crossword reserve free of repeated answers for fourteen days", async () => {
    const answers = (
      await Promise.all(
        reserveHorizon().slice(0, 14).map(async (targetDate) => {
          const generated = await deterministicContentGenerator.generate({
            budgetMicros: 0,
            contentType: "crossword",
            id: `crossword-${targetDate}`,
            promptVersion: "v1",
            provider: "deterministic",
            targetDifficulty: 2,
            targetDate,
          });
          if (generated.candidate.type !== "crossword") throw new Error("crossword");
          return generated.candidate.privatePayload.entries.map((entry) => entry.answer);
        }),
      )
    ).flat();
    expect(new Set(answers)).toHaveLength(42);
  });

  it("keeps the true-false reserve balanced and free of repeated statements for fourteen days", async () => {
    const items = (
      await Promise.all(
        reserveHorizon().slice(0, 14).map(async (targetDate) => {
          const generated = await deterministicContentGenerator.generate({
            budgetMicros: 0,
            contentType: "true_false",
            id: `true-false-${targetDate}`,
            promptVersion: "v1",
            provider: "deterministic",
            targetDifficulty: 1,
            targetDate,
          });
          if (generated.candidate.type !== "true_false") throw new Error("true_false");
          const values = new Map(
            generated.candidate.privatePayload.items.map((item) => [item.id, item.value]),
          );
          return generated.candidate.publicPayload.items.map((item) => ({
            statement: item.statement,
            value: values.get(item.id),
          }));
        }),
      )
    ).flat();
    expect(new Set(items.map(({ statement }) => statement))).toHaveLength(42);
    expect(items.filter(({ value }) => value)).toHaveLength(21);
  });

  it("keeps the quiz reserve free of repeated prompts for fourteen days", async () => {
    const prompts = (
      await Promise.all(
        reserveHorizon().slice(0, 14).map(async (targetDate) => {
          const generated = await deterministicContentGenerator.generate({
            budgetMicros: 0,
            contentType: "quiz",
            id: `quiz-${targetDate}`,
            promptVersion: "v1",
            provider: "deterministic",
            targetDifficulty: 2,
            targetDate,
          });
          if (generated.candidate.type !== "quiz") throw new Error("quiz");
          return generated.candidate.publicPayload.questions.map((question) => question.prompt);
        }),
      )
    ).flat();
    expect(new Set(prompts)).toHaveLength(70);
  });

  it("keeps every supported quiz difficulty playable through the public contract", async () => {
    const generated = await deterministicContentGenerator.generate({
      budgetMicros: 0,
      contentType: "quiz",
      id: "all-levels",
      promptVersion: "v1",
      provider: "deterministic",
      targetDifficulty: 2,
      targetDate: "2026-08-03",
    });
    if (generated.candidate.type !== "quiz") throw new Error("quiz");
    const difficulties = ["very_easy", "easy", "medium", "hard", "expert"] as const;
    expect(
      isQuizPublicPayload({
        ...generated.candidate.publicPayload,
        questions: generated.candidate.publicPayload.questions.map((question, index) => ({
          ...question,
          difficulty: difficulties[index]!,
        })),
      }),
    ).toBe(true);
  });

  it("fails explicitly when an inactive difficulty has no curated fallback", async () => {
    await expect(
      deterministicContentGenerator.generate({
        budgetMicros: 0,
        contentType: "true_false",
        id: "unsupported-level",
        promptVersion: "v1",
        provider: "deterministic",
        targetDifficulty: 5,
        targetDate: "2026-08-03",
      }),
    ).rejects.toThrow("No curated content exists for this target difficulty");
  });

  it("publishes the configured word-search difficulty through the public contract", async () => {
    const generated = await deterministicContentGenerator.generate({
      budgetMicros: 0,
      contentType: "word_search",
      id: "word-search-level",
      promptVersion: "v1",
      provider: "deterministic",
      targetDifficulty: 2,
      targetDate: "2026-08-03",
    });
    if (generated.candidate.type !== "word_search") throw new Error("word_search");
    expect(generated.candidate.publicPayload.difficulty).toBe(2);
    expect(isWordSearchPublicPayload(generated.candidate.publicPayload)).toBe(true);
  });
});

function reserveHorizon(): readonly string[] {
  return Array.from({ length: 21 }, (_, index) => {
    const date = new Date("2026-08-03T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

const defaultDifficulties = {
  crossword: 2,
  guess_word: 1,
  quiz: 2,
  true_false: 1,
  word_search: 2,
} as const;

function targetDifficulty(type: keyof typeof defaultDifficulties) {
  return defaultDifficulties[type];
}
