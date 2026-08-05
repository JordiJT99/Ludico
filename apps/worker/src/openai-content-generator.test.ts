import { describe, expect, it, vi } from "vitest";
import { deterministicContentGenerator } from "./fake-content-generator.js";
import {
  OpenAIContentGenerationError,
  OpenAIContentGenerator,
} from "./openai-content-generator.js";

describe("OpenAI content generator", () => {
  it("sends a structured Responses request and validates the returned candidate", async () => {
    const curated = await deterministicContentGenerator.generate(job());
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify(curated.candidate),
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      ),
    );
    const generator = new OpenAIContentGenerator({
      apiKey: "test-key",
      fetch: request,
      inputTokenMicros: 2,
      model: "test-model",
      outputTokenMicros: 3,
    });

    await expect(generator.generate(job())).resolves.toMatchObject({ costMicros: 80 });
    const [, init] = request.mock.calls[0]!;
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "test-model",
      text: { format: { name: "daily_content_candidate", type: "json_schema" } },
    });
  });

  it("redacts provider failures and rejects malformed output", async () => {
    const rejected = new OpenAIContentGenerator({
      apiKey: "secret",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 401 })),
      model: "test-model",
    });
    await expect(rejected.generate(job())).rejects.toEqual(
      new OpenAIContentGenerationError("OPENAI_HTTP"),
    );

    const malformed = new OpenAIContentGenerator({
      apiKey: "secret",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ output_text: "{}" }))),
      model: "test-model",
    });
    await expect(malformed.generate(job())).rejects.toEqual(
      new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE"),
    );
  });
});

function job() {
  return {
    budgetMicros: 1_000,
    contentType: "guess_word" as const,
    id: "job-openai",
    promptVersion: "v1",
    provider: "openai",
    targetDate: "2026-08-03",
    targetDifficulty: 1 as const,
  };
}
