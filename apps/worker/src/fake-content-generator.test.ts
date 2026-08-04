import { validateGeneratedContent } from "@ludico/domain";
import { describe, expect, it } from "vitest";
import { fakeContentAssurance, fakeContentGenerator } from "./fake-content-generator.js";

describe("explicit fake content provider", () => {
  it.each(["quiz", "crossword", "true_false", "guess_word", "word_search"] as const)(
    "generates valid %s fixtures only on demand",
    async (type) => {
      const generated = await fakeContentGenerator.generate({
        budgetMicros: 0,
        contentType: type,
        id: `job-${type}`,
        promptVersion: "v1",
        provider: "fake",
        targetDate: "2026-08-03",
      });
      expect(generated.costMicros).toBe(0);
      expect(validateGeneratedContent(generated.candidate)).toMatchObject({ status: "valid" });
      await expect(fakeContentAssurance.verifySources(generated.candidate)).resolves.toBe(true);
      await expect(fakeContentAssurance.evaluate(generated.candidate)).resolves.toBe(true);
    },
  );
});
