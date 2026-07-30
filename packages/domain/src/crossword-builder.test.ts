import { describe, expect, it } from "vitest";
import {
  assessCrosswordQuality,
  constructCrossword,
  countCrosswordSolutions,
  CrosswordConstructionError,
  type WordBankEntry,
} from "./crossword-builder.js";
import {
  foldCrosswordLetter,
  validateCrossword,
  type CrosswordPrivateSolution,
} from "./crossword.js";

const bank: WordBankEntry[] = [
  entry("sol", "SOL", "Astro que ilumina el día"),
  entry("sal", "SAL", "Condimento mineral"),
  entry("luz", "LUZ", "Lo contrario de oscuridad"),
  entry("sur", "SUR", "Punto cardinal opuesto al norte"),
  entry("riel", "RIEL", "Barra metálica de una vía"),
];

describe("bounded deterministic crossword construction", () => {
  it("recomposes a valid unique grid reproducibly from a curated bank", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const options = {
        entryCount: 3,
        seed: `seed-${seed}`,
        title: "Crucigrama construido",
        vocabularyVersion: "bank-es-v1",
      };
      const first = constructCrossword(bank, options);
      const second = constructCrossword(bank, options);
      expect(second).toEqual(first);
      expect(first.type).toBe("crossword");
      if (first.type !== "crossword") continue;
      expect(() => validateCrossword(first.publicPayload, first.privatePayload)).not.toThrow();
      expect(countCrosswordSolutions(first.publicPayload, bank)).toBe(1);
      expect(assessCrosswordQuality(first.publicPayload)).toMatchObject({
        density: expect.any(Number),
        intersections: expect.any(Number),
        score: expect.any(Number),
      });
    }
  });

  it("detects alternatives and exits cleanly when the search budget is exhausted", () => {
    const built = constructCrossword(bank, {
      entryCount: 3,
      seed: "unique",
      title: "Crucigrama construido",
      vocabularyVersion: "bank-es-v1",
    });
    if (built.type !== "crossword") throw new Error("Tipo inesperado");
    const used = built.privatePayload as CrosswordPrivateSolution;
    const first = bank.find(({ answer }) => answer === used.entries[0]!.answer)!;
    expect(
      countCrosswordSolutions(built.publicPayload, [
        ...bank,
        { ...first, id: `${first.id}-duplicate` },
      ]),
    ).toBe(2);

    expect(() =>
      constructCrossword(
        [entry("aaa", "AAA", "A"), entry("bbb", "BBB", "B"), entry("ccc", "CCC", "C")],
        {
          entryCount: 3,
          maxSearchNodes: 1,
          seed: "impossible",
          title: "Sin salida",
          vocabularyVersion: "bank-es-v1",
        },
      ),
    ).toThrow(new CrosswordConstructionError("SEARCH_LIMIT"));
  });

  it("enforces configured geometry and rejects equivalent answers in the word bank", () => {
    expect(foldCrosswordLetter("ÁRBOL")).toBe("ARBOL");
    expect(foldCrosswordLetter("NIÑO")).toBe("NIÑO");
    expect(() =>
      constructCrossword(bank, {
        entryCount: 3,
        maxColumns: 3,
        maxRows: 3,
        minDensity: 0.9,
        seed: "too-dense",
        title: "Sin salida",
        vocabularyVersion: "bank-es-v1",
      }),
    ).toThrow(new CrosswordConstructionError("NO_LAYOUT"));

    expect(() =>
      constructCrossword([...bank, entry("sol-alt", "SOL", "Alternativa")], {
        entryCount: 3,
        seed: "duplicate-answer",
        title: "Duplicado",
        vocabularyVersion: "bank-es-v1",
      }),
    ).toThrow(new CrosswordConstructionError("INVALID_BANK"));
  });
});

function entry(id: string, answer: string, clue: string): WordBankEntry {
  return { answer, clue, id, sourceUrl: `https://example.com/dictionary/${id}` };
}
