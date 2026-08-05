import {
  isGuessWordLocalDraft,
  isWordSearchLocalDraft,
  isWordSearchPublicPayload,
} from "@ludico/contracts";
import { describe, expect, it } from "vitest";

const legacyPayload = {
  columns: 4,
  grid: [
    ["S", "O", "L", "A"],
    ["L", "U", "N", "A"],
    ["N", "U", "B", "E"],
    ["A", "R", "B", "O"],
  ],
  kind: "word-search",
  rows: 4,
  seed: "legacy-word-search",
  title: "Sopa de letras",
  words: [
    { answer: "SOL", id: "one" },
    { answer: "LUNA", id: "two" },
    { answer: "NUBE", id: "three" },
  ],
} as const;

describe("word-search public contract", () => {
  it("keeps published payloads from before difficulty was exposed playable", () => {
    expect(isWordSearchPublicPayload(legacyPayload)).toBe(true);
    expect(isWordSearchPublicPayload({ ...legacyPayload, difficulty: 0 })).toBe(false);
  });

  it("accepts only locally queued events with a valid public payload and attempt", () => {
    const attempt = {
      attemptId: "7a8e7f30-7f64-4a12-8a55-2f0a2d8ad8ba",
      foundEntries: [],
      status: "in_progress",
      version: 1,
    } as const;
    const draft = {
      attempt,
      contentVersion: 1,
      game: legacyPayload,
      gameId: "game",
      pendingEvents: [
        {
          clientEventId: "event",
          elapsedMs: 100,
          endColumn: 2,
          endRow: 1,
          entryId: "one",
          startColumn: 0,
          startRow: 1,
          version: 1,
        },
      ],
      savedAt: "2026-08-05T12:00:00.000Z",
    } as const;
    expect(isWordSearchLocalDraft(draft, "game")).toBe(true);
    expect(
      isWordSearchLocalDraft(
        { ...draft, pendingEvents: [{ ...draft.pendingEvents[0], version: 0 }] },
        "game",
      ),
    ).toBe(false);

    expect(
      isGuessWordLocalDraft(
        {
          attempt: { attemptId: "attempt", guesses: [], status: "in_progress", version: 1 },
          contentVersion: 1,
          game: {
            allowedCharacters: ["A"],
            category: "Naturaleza",
            definition: "Árbol",
            difficulty: 1,
            hints: [{ text: "Tiene tronco", unlockAfterAttempts: 0 }],
            id: "word",
            kind: "guess-word",
            maxAttempts: 3,
            title: "Adivina",
          },
          gameId: "guess",
          pendingEvents: [{ clientEventId: "event", elapsedMs: 100, guess: "ARBOL", version: 1 }],
          savedAt: "2026-08-05T12:00:00.000Z",
        },
        "guess",
      ),
    ).toBe(true);
  });
});
