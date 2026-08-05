import type { GeneratedContentCandidate } from "@ludico/domain";
import { validateGeneratedContent } from "@ludico/domain";
import type { ContentJob } from "@ludico/database";
import type { ContentGeneratorPort } from "./content-jobs.js";

export class OpenAIContentGenerationError extends Error {
  constructor(readonly code: "OPENAI_HTTP" | "OPENAI_INVALID_RESPONSE" | "OPENAI_TIMEOUT") {
    super(code);
  }
}

export class OpenAIContentGenerator implements ContentGeneratorPort {
  constructor(
    private readonly options: Readonly<{
      apiKey: string;
      fetch?: typeof fetch;
      inputTokenMicros?: number;
      model: string;
      outputTokenMicros?: number;
      timeoutMs?: number;
    }>,
  ) {
    if (!options.apiKey.trim() || !options.model.trim() || (options.timeoutMs ?? 30_000) < 1) {
      throw new RangeError("OPENAI_CONTENT_CONFIGURATION_INVALID");
    }
  }

  async generate(job: ContentJob) {
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
        body: JSON.stringify({
          input: [
            {
              content: [
                {
                  text: [
                    "Genera un único juego diario original en español de España.",
                    `Tipo: ${job.contentType}. Dificultad: ${job.targetDifficulty}/5.`,
                    `Fecha objetivo: ${job.targetDate}.`,
                    "Incluye fuentes HTTPS por cada elemento, una única solución y texto apto para móvil.",
                    "No uses contenido sensible, temporal o protegido.",
                    "Devuelve exclusivamente el candidato JSON solicitado.",
                  ].join("\n"),
                  type: "input_text",
                },
              ],
              role: "user",
            },
          ],
          model: this.options.model,
          text: {
            format: {
              name: "daily_content_candidate",
              schema: candidateSchema,
              strict: false,
              type: "json_schema",
            },
          },
        }),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new OpenAIContentGenerationError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "OPENAI_TIMEOUT"
          : "OPENAI_HTTP",
      );
    }
    if (!response.ok) throw new OpenAIContentGenerationError("OPENAI_HTTP");

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE");
    }
    const text = outputText(body);
    if (!text) throw new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE");

    let candidate: GeneratedContentCandidate;
    try {
      candidate = JSON.parse(text) as GeneratedContentCandidate;
    } catch {
      throw new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE");
    }
    let validation;
    try {
      validation = validateGeneratedContent(candidate, { targetDifficulty: job.targetDifficulty });
    } catch {
      throw new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE");
    }
    if (validation.status === "rejected") {
      throw new OpenAIContentGenerationError("OPENAI_INVALID_RESPONSE");
    }
    const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
    return {
      candidate,
      costMicros:
        numberValue(usage.input_tokens) * (this.options.inputTokenMicros ?? 0) +
        numberValue(usage.output_tokens) * (this.options.outputTokenMicros ?? 0),
    };
  }
}

const candidateSchema = {
  additionalProperties: false,
  properties: {
    privatePayload: { type: "object" },
    publicPayload: { type: "object" },
    sources: { type: "array" },
    type: {
      enum: ["quiz", "crossword", "true_false", "guess_word", "word_search"],
      type: "string",
    },
  },
  required: ["type", "publicPayload", "privatePayload", "sources"],
  type: "object",
} as const;

function outputText(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return null;
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
