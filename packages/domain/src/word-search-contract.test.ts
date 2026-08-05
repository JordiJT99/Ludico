import { isWordSearchPublicPayload } from "@ludico/contracts";
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
});
