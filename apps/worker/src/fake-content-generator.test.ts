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
      targetDate: "2026-08-03",
    });
    const next = await deterministicContentGenerator.generate({
      budgetMicros: 0,
      contentType: "quiz",
      id: "next",
      promptVersion: "v1",
      provider: "deterministic",
      targetDate: "2026-08-04",
    });
    if (first.candidate.type !== "quiz" || next.candidate.type !== "quiz") throw new Error("quiz");
    expect(first.candidate.publicPayload.questions.map(({ prompt }) => prompt)).not.toEqual(
      next.candidate.publicPayload.questions.map(({ prompt }) => prompt),
    );
  });
});

function reserveHorizon(): readonly string[] {
  return Array.from({ length: 21 }, (_, index) => {
    const date = new Date("2026-08-03T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}
