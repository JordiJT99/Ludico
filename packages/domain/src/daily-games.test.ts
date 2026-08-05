import { describe, expect, it } from "vitest";
import {
  constructWordSearch,
  DailyGameValidationError,
  validateGuessWord,
  validateTrueFalse,
  validateWordSearch,
} from "./daily-games.js";

describe("daily game validators", () => {
  it("validates balanced true/false and an unambiguous guess word", () => {
    expect(() =>
      validateTrueFalse([
        item("La Tierra gira alrededor del Sol.", true),
        item("El Sol gira alrededor de la Tierra.", false),
        item("El agua hierve a 100 grados al nivel del mar.", true),
      ]),
    ).not.toThrow();
    expect(() => validateGuessWord(guessWord())).not.toThrow();
  });

  it("constructs reproducible, reconstructible word searches across 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const config = {
        columns: 8,
        directions: ["east", "south", "southEast"] as const,
        rows: 8,
        seed: `word-search-${seed}`,
        words: ["SOL", "LUNA", "NUBE"],
      };
      const first = constructWordSearch(config);
      expect(constructWordSearch(config)).toEqual(first);
      expect(() => validateWordSearch(first)).not.toThrow();
      expect(() => validateWordSearch({ ...first, grid: [] })).toThrow(DailyGameValidationError);
    }
  });
});

function item(statement: string, value: boolean) {
  return {
    category: "Ciencia",
    difficulty: 2 as const,
    explanation: "Explicaci\u00f3n factual comprobada.",
    sourceUrl: "https://example.com/source",
    statement,
    value,
  };
}

function guessWord() {
  return {
    allowedCharacters: ["A", "R", "B", "O", "L"],
    alternativeAnswers: [],
    answer: "ARBOL",
    category: "Naturaleza",
    definition: "Planta le\u00f1osa con tronco y copa.",
    difficulty: 2 as const,
    hints: [{ text: "Tiene ra\u00edces.", unlockAfterAttempts: 1 }],
    maxAttempts: 5,
  };
}
