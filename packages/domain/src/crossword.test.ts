import type { CrosswordAttemptCell, CrosswordPublicPayload } from "@ludico/contracts";
import { describe, expect, it } from "vitest";
import {
  calculateCrosswordScore,
  foldCrosswordLetter,
  InvalidCrosswordError,
  normalizeCrosswordLetter,
  type CrosswordPrivateSolution,
  validateCrossword,
} from "./crossword.js";
import { applyCrosswordEvents, synchronizeCrosswordProgress } from "./crossword-progress.js";

const crossword: CrosswordPublicPayload = {
  blocks: [
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ],
  cells: [
    cell("a0000000-0000-4000-8000-000000000000", 0, 0, 1),
    cell("a0000000-0000-4000-8000-000000000001", 0, 1),
    cell("a0000000-0000-4000-8000-000000000002", 0, 2),
    cell("a0000000-0000-4000-8000-000000000010", 1, 0),
    cell("a0000000-0000-4000-8000-000000000020", 2, 0, 2),
    cell("a0000000-0000-4000-8000-000000000021", 2, 1),
    cell("a0000000-0000-4000-8000-000000000022", 2, 2),
  ],
  columns: 3,
  entries: [
    {
      cellIds: cellIds(0, 1, 2),
      clue: "Astro que ilumina el día",
      direction: "across",
      id: "e0000000-0000-4000-8000-000000000001",
      number: 1,
    },
    {
      cellIds: [
        "a0000000-0000-4000-8000-000000000000",
        "a0000000-0000-4000-8000-000000000010",
        "a0000000-0000-4000-8000-000000000020",
      ],
      clue: "Condimento mineral",
      direction: "down",
      id: "e0000000-0000-4000-8000-000000000002",
      number: 1,
    },
    {
      cellIds: cellIds(20, 21, 22),
      clue: "Lo contrario de oscuridad",
      direction: "across",
      id: "e0000000-0000-4000-8000-000000000003",
      number: 2,
    },
  ],
  kind: "crossword",
  rows: 3,
  rules: { accentPolicy: "fold" },
  title: "Crucigrama de prueba",
};

const solution: CrosswordPrivateSolution = {
  entries: [
    { answer: "SOL", entryId: crossword.entries[0]!.id },
    { answer: "SAL", entryId: crossword.entries[1]!.id },
    { answer: "LUZ", entryId: crossword.entries[2]!.id },
  ],
  kind: "crossword-solution",
  uniqueness: { alternativeCount: 1, vocabularyVersion: "test-v1" },
};

describe("crossword validation", () => {
  it("accepts a connected, numbered and internally consistent grid", () => {
    expect(() => validateCrossword(crossword, solution)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(crossword)) as CrosswordPublicPayload;
    expect(() => validateCrossword(roundTrip, solution)).not.toThrow();
  });

  it("rejects incomplete masks, unstable numbering and conflicting crossings", () => {
    expect(() => validateCrossword({ ...crossword, blocks: [] }, solution)).toThrow(
      InvalidCrosswordError,
    );
    expect(() =>
      validateCrossword(
        {
          ...crossword,
          cells: crossword.cells.map((item) =>
            item.id === crossword.cells[4]!.id ? { ...item, number: 3 } : item,
          ),
        },
        solution,
      ),
    ).toThrow(InvalidCrosswordError);
    expect(() =>
      validateCrossword(crossword, {
        ...solution,
        entries: solution.entries.map((entry, index) =>
          index === 1 ? { ...entry, answer: "SOS" } : entry,
        ),
      }),
    ).toThrow(InvalidCrosswordError);
  });
});

describe("crossword normalization and score v1", () => {
  it("folds Spanish accents without collapsing Ñ into N", () => {
    expect(normalizeCrosswordLetter("á")).toBe("Á");
    expect(normalizeCrosswordLetter("ab")).toBeNull();
    expect(foldCrosswordLetter("Á")).toBe("A");
    expect(foldCrosswordLetter("Ñ")).toBe("Ñ");
    expect(foldCrosswordLetter("N")).toBe("N");
  });

  it("scores correct letters, words, completion and hints on the server", () => {
    const cells: CrosswordAttemptCell[] = ["S", "O", "L", "Á", "L", "U", "Z"].map(
      (value, index) => ({
        cellId: crossword.cells[index]!.id,
        elapsedMs: 100,
        value,
      }),
    );

    expect(calculateCrosswordScore(crossword, solution, cells, 0)).toEqual({
      completed: true,
      completedWords: 3,
      correctLetters: 7,
      points: 1_350,
      scoreVersion: "crossword-v1",
      solved: true,
    });
    expect(calculateCrosswordScore(crossword, solution, cells, 2).points).toBe(1_150);
  });
});

describe("crossword progress", () => {
  it("applies writes and erasures by cell", () => {
    const attempt = {
      attemptId: "f0000000-0000-4000-8000-000000000001",
      cells: [{ cellId: crossword.cells[0]!.id, elapsedMs: 1, value: "S" }],
      hintsUsed: 0,
      status: "in_progress" as const,
      version: 1,
    };
    const next = applyCrosswordEvents(attempt, [
      {
        cellId: crossword.cells[0]!.id,
        clientEventId: "f0000000-0000-4000-8000-000000000002",
        elapsedMs: 2,
        value: "",
      },
      {
        cellId: crossword.cells[1]!.id,
        clientEventId: "f0000000-0000-4000-8000-000000000003",
        elapsedMs: 3,
        value: "O",
      },
    ]);
    expect(next.cells).toEqual([{ cellId: crossword.cells[1]!.id, elapsedMs: 3, value: "O" }]);
  });

  it("replays the exact local event after one canonical conflict", async () => {
    const attempt = {
      attemptId: "f0000000-0000-4000-8000-000000000001",
      cells: [],
      hintsUsed: 0,
      status: "in_progress" as const,
      version: 2,
    };
    const events = [
      {
        cellId: crossword.cells[0]!.id,
        clientEventId: "f0000000-0000-4000-8000-000000000004",
        elapsedMs: 4,
        value: "S",
      },
    ];
    const versions: number[] = [];
    const result = await synchronizeCrosswordProgress(attempt, events, async (version) => {
      versions.push(version);
      return versions.length === 1
        ? { code: "VERSION_CONFLICT", state: { ...attempt, version: 3 } }
        : { savedEvents: 1, status: "saved", version: 4 };
    });
    expect(versions).toEqual([2, 3]);
    expect(result).toMatchObject({ cells: [{ value: "S" }], version: 4 });
  });
});

function cell(id: string, row: number, column: number, number?: number) {
  return { column, id, ...(number ? { number } : {}), row };
}

function cellIds(...suffixes: number[]) {
  return suffixes.map(
    (suffix) => `a0000000-0000-4000-8000-0000000000${String(suffix).padStart(2, "0")}`,
  );
}
