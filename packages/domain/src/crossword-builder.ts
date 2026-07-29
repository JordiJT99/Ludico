import type { CrosswordPublicPayload } from "@ludico/contracts";
import type { GeneratedContentCandidate } from "./content-validation.js";
import {
  foldCrosswordLetter,
  type CrosswordPrivateSolution,
  validateCrossword,
} from "./crossword.js";

export interface WordBankEntry {
  readonly answer: string;
  readonly clue: string;
  readonly id: string;
  readonly sourceUrl: string;
}

export interface CrosswordBuildOptions {
  readonly entryCount?: number;
  readonly maxSearchNodes?: number;
  readonly seed: string;
  readonly timeLimitMs?: number;
  readonly title: string;
  readonly vocabularyVersion: string;
}

type Direction = "across" | "down";
type PreparedEntry = WordBankEntry & { letters: readonly string[] };
type Placement = PreparedEntry & { column: number; direction: Direction; row: number };
type GridCell = { directions: Set<Direction>; letter: string };
type CrosswordCandidate = Extract<GeneratedContentCandidate, { type: "crossword" }>;

export class CrosswordConstructionError extends Error {
  constructor(readonly code: "INVALID_BANK" | "NO_LAYOUT" | "NON_UNIQUE" | "SEARCH_LIMIT") {
    super(code);
    this.name = "CrosswordConstructionError";
  }
}

export function constructCrossword(
  bank: readonly WordBankEntry[],
  options: CrosswordBuildOptions,
): CrosswordCandidate {
  const prepared = prepareBank(bank);
  const entryCount = options.entryCount ?? Math.min(7, prepared.length);
  if (
    entryCount < 2 ||
    entryCount > prepared.length ||
    !options.seed ||
    !options.title.trim() ||
    !options.vocabularyVersion.trim()
  ) {
    throw new CrosswordConstructionError("INVALID_BANK");
  }
  const ordered = shuffle(prepared, options.seed);
  const maxNodes = options.maxSearchNodes ?? 20_000;
  const deadline = Date.now() + (options.timeLimitMs ?? 100);
  let nodes = 0;
  const consumeNode = () => {
    nodes += 1;
    if (nodes > maxNodes || Date.now() > deadline) {
      throw new CrosswordConstructionError("SEARCH_LIMIT");
    }
  };

  let placements: readonly Placement[] | null = null;
  for (const first of ordered) {
    placements = search(
      ordered,
      [{ ...first, column: 0, direction: "across" as const, row: 0 }],
      new Set([first.id]),
      entryCount,
      consumeNode,
    );
    if (placements) break;
  }
  if (!placements) throw new CrosswordConstructionError("NO_LAYOUT");

  const candidate = toCandidate(placements, bank, options);
  if (countCrosswordSolutions(candidate.publicPayload, bank) !== 1) {
    throw new CrosswordConstructionError("NON_UNIQUE");
  }
  validateCrossword(candidate.publicPayload, candidate.privatePayload as CrosswordPrivateSolution);
  return candidate;
}

export function countCrosswordSolutions(
  crossword: CrosswordPublicPayload,
  bank: readonly WordBankEntry[],
  limit = 2,
): number {
  const prepared = prepareBank(bank);
  const choices = crossword.entries
    .map((entry) => ({
      entry,
      candidates: prepared.filter(
        (candidate) =>
          candidate.letters.length === entry.cellIds.length &&
          normalizeText(candidate.clue) === normalizeText(entry.clue),
      ),
    }))
    .sort((left, right) => left.candidates.length - right.candidates.length);
  let count = 0;
  const letters = new Map<string, string>();
  const used = new Set<string>();

  function visit(index: number): void {
    if (count >= limit) return;
    const choice = choices[index];
    if (!choice) {
      count += 1;
      return;
    }
    for (const candidate of choice.candidates) {
      if (used.has(candidate.id)) continue;
      const compatible = choice.entry.cellIds.every((cellId, letterIndex) => {
        const previous = letters.get(cellId);
        return !previous || previous === candidate.letters[letterIndex];
      });
      if (!compatible) continue;
      const added: string[] = [];
      choice.entry.cellIds.forEach((cellId, letterIndex) => {
        if (!letters.has(cellId)) {
          letters.set(cellId, candidate.letters[letterIndex]!);
          added.push(cellId);
        }
      });
      used.add(candidate.id);
      visit(index + 1);
      used.delete(candidate.id);
      added.forEach((cellId) => letters.delete(cellId));
    }
  }

  visit(0);
  return count;
}

function search(
  bank: readonly PreparedEntry[],
  placements: readonly Placement[],
  used: ReadonlySet<string>,
  target: number,
  consumeNode: () => void,
): readonly Placement[] | null {
  if (placements.length === target) return density(placements) >= 0.35 ? placements : null;
  const grid = buildGrid(placements);
  for (const entry of bank) {
    if (used.has(entry.id)) continue;
    consumeNode();
    for (const placement of possiblePlacements(entry, grid)) {
      if (!fits(placement, grid, placements)) continue;
      const next = [...placements, placement];
      const result = search(bank, next, new Set([...used, entry.id]), target, consumeNode);
      if (result) return result;
    }
  }
  return null;
}

function possiblePlacements(
  entry: PreparedEntry,
  grid: ReadonlyMap<string, GridCell>,
): Placement[] {
  const placements = new Map<string, Placement>();
  for (const [coordinate, cell] of grid) {
    const [row, column] = coordinate.split(":").map(Number) as [number, number];
    entry.letters.forEach((letter, index) => {
      if (letter !== cell.letter) return;
      for (const occupiedDirection of cell.directions) {
        const direction: Direction = occupiedDirection === "across" ? "down" : "across";
        const placement: Placement = {
          ...entry,
          column: direction === "across" ? column - index : column,
          direction,
          row: direction === "down" ? row - index : row,
        };
        placements.set(`${placement.row}:${placement.column}:${placement.direction}`, placement);
      }
    });
  }
  return [...placements.values()];
}

function fits(
  placement: Placement,
  grid: ReadonlyMap<string, GridCell>,
  placements: readonly Placement[],
): boolean {
  const before = coordinateAt(placement, -1);
  const after = coordinateAt(placement, placement.letters.length);
  if (grid.has(key(before.row, before.column)) || grid.has(key(after.row, after.column)))
    return false;
  let crossings = 0;
  for (let index = 0; index < placement.letters.length; index += 1) {
    const coordinate = coordinateAt(placement, index);
    const current = grid.get(key(coordinate.row, coordinate.column));
    if (current) {
      if (
        current.letter !== placement.letters[index] ||
        current.directions.has(placement.direction)
      ) {
        return false;
      }
      crossings += 1;
      continue;
    }
    const neighbors =
      placement.direction === "across"
        ? [key(coordinate.row - 1, coordinate.column), key(coordinate.row + 1, coordinate.column)]
        : [key(coordinate.row, coordinate.column - 1), key(coordinate.row, coordinate.column + 1)];
    if (neighbors.some((neighbor) => grid.has(neighbor))) return false;
  }
  const bounds = getBounds([...placements, placement]);
  return crossings > 0 && bounds.rows <= 21 && bounds.columns <= 21;
}

function toCandidate(
  placements: readonly Placement[],
  bank: readonly WordBankEntry[],
  options: CrosswordBuildOptions,
): CrosswordCandidate {
  const bounds = getBounds(placements);
  const normalized = placements.map((placement) => ({
    ...placement,
    column: placement.column - bounds.minColumn,
    row: placement.row - bounds.minRow,
  }));
  const coordinates = [...buildGrid(normalized).keys()]
    .map((coordinate) => coordinate.split(":").map(Number) as [number, number])
    .sort(([leftRow, leftColumn], [rightRow, rightColumn]) =>
      leftRow === rightRow ? leftColumn - rightColumn : leftRow - rightRow,
    );
  const cellIds = new Map(
    coordinates.map(([row, column], index) => [
      key(row, column),
      stableUuid(options.seed, "cell", index),
    ]),
  );
  const startKeys = [...new Set(normalized.map(({ row, column }) => key(row, column)))].sort(
    coordinateSort,
  );
  const numbers = new Map(startKeys.map((coordinate, index) => [coordinate, index + 1]));
  const cells = coordinates.map(([row, column]) => {
    const number = numbers.get(key(row, column));
    return {
      column,
      id: cellIds.get(key(row, column))!,
      ...(number ? { number } : {}),
      row,
    };
  });
  const blocks = [];
  for (let row = 0; row < bounds.rows; row += 1) {
    for (let column = 0; column < bounds.columns; column += 1) {
      if (!cellIds.has(key(row, column))) blocks.push({ column, row });
    }
  }
  const entries = normalized.map((placement, index) => ({
    cellIds: placement.letters.map((_, letterIndex) => {
      const coordinate = coordinateAt(placement, letterIndex);
      return cellIds.get(key(coordinate.row, coordinate.column))!;
    }),
    clue: placement.clue,
    direction: placement.direction,
    id: stableUuid(options.seed, "entry", index),
    number: numbers.get(key(placement.row, placement.column))!,
  }));
  return {
    privatePayload: {
      entries: normalized.map((placement, index) => ({
        answer: placement.answer,
        entryId: entries[index]!.id,
      })),
      kind: "crossword-solution",
      uniqueness: { alternativeCount: 1, vocabularyVersion: options.vocabularyVersion },
    },
    publicPayload: {
      blocks,
      cells,
      columns: bounds.columns,
      entries,
      kind: "crossword",
      rows: bounds.rows,
      rules: { accentPolicy: "fold" },
      title: options.title,
    },
    sources: normalized.map((placement, index) => ({
      itemId: entries[index]!.id,
      url: bank.find(({ id }) => id === placement.id)!.sourceUrl,
    })),
    type: "crossword",
  };
}

function prepareBank(bank: readonly WordBankEntry[]): PreparedEntry[] {
  const ids = new Set<string>();
  const entries = bank.map((entry) => ({ ...entry, letters: answerLetters(entry.answer) }));
  if (
    entries.length < 2 ||
    entries.some(
      (entry) =>
        !entry.id ||
        !ids.add(entry.id) ||
        !entry.clue.trim() ||
        entry.letters.length < 2 ||
        entry.letters.length > 21 ||
        !isHttps(entry.sourceUrl),
    )
  ) {
    throw new CrosswordConstructionError("INVALID_BANK");
  }
  return entries;
}

function answerLetters(answer: string): string[] {
  const folded = foldCrosswordLetter(answer.trim());
  const letters = Array.from(folded);
  return letters.every((letter) => /^\p{L}$/u.test(letter)) ? letters : [];
}

function buildGrid(placements: readonly Placement[]): Map<string, GridCell> {
  const grid = new Map<string, GridCell>();
  for (const placement of placements) {
    placement.letters.forEach((letter, index) => {
      const coordinate = coordinateAt(placement, index);
      const coordinateKey = key(coordinate.row, coordinate.column);
      const cell = grid.get(coordinateKey) ?? { directions: new Set<Direction>(), letter };
      cell.directions.add(placement.direction);
      grid.set(coordinateKey, cell);
    });
  }
  return grid;
}

function coordinateAt(placement: Placement, index: number) {
  return {
    column: placement.column + (placement.direction === "across" ? index : 0),
    row: placement.row + (placement.direction === "down" ? index : 0),
  };
}

function getBounds(placements: readonly Placement[]) {
  const coordinates = placements.flatMap((placement) =>
    placement.letters.map((_, index) => coordinateAt(placement, index)),
  );
  const rows = coordinates.map(({ row }) => row);
  const columns = coordinates.map(({ column }) => column);
  const minRow = Math.min(...rows);
  const minColumn = Math.min(...columns);
  return {
    columns: Math.max(...columns) - minColumn + 1,
    minColumn,
    minRow,
    rows: Math.max(...rows) - minRow + 1,
  };
}

function density(placements: readonly Placement[]): number {
  const bounds = getBounds(placements);
  return buildGrid(placements).size / (bounds.rows * bounds.columns);
}

function shuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values];
  let state = hash(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = xorshift(state);
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

function stableUuid(seed: string, kind: string, index: number): string {
  let state = hash(`${seed}:${kind}:${index}`);
  let value = "";
  for (let byte = 0; byte < 16; byte += 1) {
    state = xorshift(state);
    value += (state & 0xff).toString(16).padStart(2, "0");
  }
  value = `${value.slice(0, 12)}4${value.slice(13, 16)}8${value.slice(17)}`;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0)!;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0 || 1;
}

function xorshift(value: number): number {
  let result = value;
  result ^= result << 13;
  result ^= result >>> 17;
  result ^= result << 5;
  return result >>> 0;
}

function coordinateSort(left: string, right: string): number {
  const [leftRow, leftColumn] = left.split(":").map(Number) as [number, number];
  const [rightRow, rightColumn] = right.split(":").map(Number) as [number, number];
  return leftRow === rightRow ? leftColumn - rightColumn : leftRow - rightRow;
}

function normalizeText(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("es-ES");
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function key(row: number, column: number): string {
  return `${row}:${column}`;
}
