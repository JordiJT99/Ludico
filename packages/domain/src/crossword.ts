import type {
  CrosswordAttemptCell,
  CrosswordCellPublic,
  CrosswordPublicPayload,
} from "@ludico/contracts";

export const CROSSWORD_SCORE_VERSION = "crossword-v1";

export interface CrosswordSolutionEntry {
  readonly entryId: string;
  readonly answer: string;
}

export interface CrosswordPrivateSolution {
  readonly kind: "crossword-solution";
  readonly entries: readonly CrosswordSolutionEntry[];
  readonly uniqueness: {
    readonly alternativeCount: 1;
    readonly vocabularyVersion: string;
  };
}

export interface CrosswordScore {
  readonly completed: boolean;
  readonly completedWords: number;
  readonly correctLetters: number;
  readonly points: number;
  readonly scoreVersion: typeof CROSSWORD_SCORE_VERSION;
  readonly solved: boolean;
}

export function validateCrossword(
  crossword: CrosswordPublicPayload,
  solution: CrosswordPrivateSolution,
): void {
  if (
    !Number.isInteger(crossword.rows) ||
    !Number.isInteger(crossword.columns) ||
    crossword.rows < 3 ||
    crossword.columns < 3 ||
    crossword.rows > 21 ||
    crossword.columns > 21
  ) {
    throw new InvalidCrosswordError("La cuadrícula debe medir entre 3 y 21 celdas por eje");
  }
  if (crossword.entries.length < 2) {
    throw new InvalidCrosswordError("El crucigrama necesita al menos dos palabras");
  }
  if (
    solution.kind !== "crossword-solution" ||
    solution.uniqueness.alternativeCount !== 1 ||
    !solution.uniqueness.vocabularyVersion.trim()
  ) {
    throw new InvalidCrosswordError("La unicidad debe estar verificada contra un vocabulario");
  }

  const cellById = new Map<string, CrosswordCellPublic>();
  const occupied = new Set<string>();
  for (const cell of crossword.cells) {
    assertInBounds(crossword, cell.row, cell.column);
    const coordinate = coordinateKey(cell.row, cell.column);
    if (cellById.has(cell.id) || occupied.has(coordinate)) {
      throw new InvalidCrosswordError("Las celdas deben tener ID y coordenada únicos");
    }
    cellById.set(cell.id, cell);
    occupied.add(coordinate);
  }

  const blocks = new Set<string>();
  for (const block of crossword.blocks) {
    assertInBounds(crossword, block.row, block.column);
    const coordinate = coordinateKey(block.row, block.column);
    if (occupied.has(coordinate) || !blocks.add(coordinate)) {
      throw new InvalidCrosswordError("La máscara contiene coordenadas duplicadas");
    }
  }
  if (occupied.size + blocks.size !== crossword.rows * crossword.columns) {
    throw new InvalidCrosswordError("Celdas y bloques deben cubrir toda la cuadrícula");
  }

  const entryIds = new Set<string>();
  const directionStarts = new Set<string>();
  const usedCells = new Set<string>();
  const entryStarts = new Map<string, CrosswordCellPublic>();
  for (const entry of crossword.entries) {
    if (!entryIds.add(entry.id)) throw new InvalidCrosswordError("ID de palabra duplicado");
    if (!entry.clue.trim()) throw new InvalidCrosswordError("Cada palabra necesita una pista");
    const cells = entry.cellIds.map((cellId) => cellById.get(cellId));
    if (cells.length < 2 || cells.some((cell) => !cell)) {
      throw new InvalidCrosswordError("Cada palabra necesita al menos dos celdas válidas");
    }
    const concreteCells = cells as CrosswordCellPublic[];
    assertConsecutive(concreteCells, entry.direction);
    const start = concreteCells[0]!;
    if (!directionStarts.add(`${coordinateKey(start.row, start.column)}:${entry.direction}`)) {
      throw new InvalidCrosswordError("Inicio y dirección de palabra duplicados");
    }
    entryStarts.set(entry.id, start);
    for (const cell of concreteCells) usedCells.add(cell.id);
  }
  if (usedCells.size !== crossword.cells.length) {
    throw new InvalidCrosswordError("Toda celda abierta debe pertenecer a una palabra");
  }
  assertConnected(crossword);
  assertNumbering(crossword, entryStarts);
  assertSolution(crossword, solution);
}

export function normalizeCrosswordLetter(value: string): string | null {
  const normalized = value.trim().normalize("NFC").toLocaleUpperCase("es-ES");
  return Array.from(normalized).length === 1 && /^\p{L}$/u.test(normalized) ? normalized : null;
}

export function foldCrosswordLetter(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleUpperCase("es-ES")
    .replace(/[ÁÀÂÄ]/g, "A")
    .replace(/[ÉÈÊË]/g, "E")
    .replace(/[ÍÌÎÏ]/g, "I")
    .replace(/[ÓÒÔÖ]/g, "O")
    .replace(/[ÚÙÛÜ]/g, "U");
}

export function calculateCrosswordScore(
  crossword: CrosswordPublicPayload,
  solution: CrosswordPrivateSolution,
  cells: readonly CrosswordAttemptCell[],
  hintsUsed: number,
): CrosswordScore {
  validateCrossword(crossword, solution);
  const expected = solutionLetters(crossword, solution);
  const entered = new Map(cells.map((cell) => [cell.cellId, cell.value]));
  const correctLetters = crossword.cells.filter((cell) => {
    const value = normalizeCrosswordLetter(entered.get(cell.id) ?? "");
    return (
      value !== null && foldCrosswordLetter(value) === foldCrosswordLetter(expected.get(cell.id)!)
    );
  }).length;
  const completedWords = crossword.entries.filter((entry) =>
    entry.cellIds.every((cellId) => {
      const value = normalizeCrosswordLetter(entered.get(cellId) ?? "");
      return (
        value !== null && foldCrosswordLetter(value) === foldCrosswordLetter(expected.get(cellId)!)
      );
    }),
  ).length;
  const completed = crossword.cells.every(
    (cell) => normalizeCrosswordLetter(entered.get(cell.id) ?? "") !== null,
  );
  const solved = correctLetters === crossword.cells.length;
  const points = Math.max(
    0,
    100 * correctLetters + 50 * completedWords + (solved ? 500 : 0) - 100 * hintsUsed,
  );
  return {
    completed,
    completedWords,
    correctLetters,
    points,
    scoreVersion: CROSSWORD_SCORE_VERSION,
    solved,
  };
}

export function getCrosswordSolutionLetter(
  crossword: CrosswordPublicPayload,
  solution: CrosswordPrivateSolution,
  cellId: string,
): string {
  validateCrossword(crossword, solution);
  const value = solutionLetters(crossword, solution).get(cellId);
  if (!value) throw new InvalidCrosswordError("La celda no pertenece a la solución");
  return value;
}

function assertInBounds(crossword: CrosswordPublicPayload, row: number, column: number) {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row >= crossword.rows ||
    column >= crossword.columns
  ) {
    throw new InvalidCrosswordError("Hay una coordenada fuera de la cuadrícula");
  }
}

function assertConsecutive(cells: readonly CrosswordCellPublic[], direction: "across" | "down") {
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    const valid =
      direction === "across"
        ? current.row === previous.row && current.column === previous.column + 1
        : current.column === previous.column && current.row === previous.row + 1;
    if (!valid) throw new InvalidCrosswordError("Las celdas de una palabra deben ser consecutivas");
  }
}

function assertConnected(crossword: CrosswordPublicPayload) {
  const entriesByCell = new Map<string, string[]>();
  for (const entry of crossword.entries) {
    for (const cellId of entry.cellIds) {
      entriesByCell.set(cellId, [...(entriesByCell.get(cellId) ?? []), entry.id]);
    }
  }
  const entryById = new Map(crossword.entries.map((entry) => [entry.id, entry]));
  const pending = [crossword.entries[0]!.id];
  const visited = new Set<string>();
  while (pending.length) {
    const entryId = pending.pop()!;
    if (visited.has(entryId)) continue;
    visited.add(entryId);
    const entry = entryById.get(entryId)!;
    for (const cellId of entry.cellIds) {
      for (const neighbor of entriesByCell.get(cellId) ?? []) pending.push(neighbor);
    }
  }
  if (visited.size !== crossword.entries.length) {
    throw new InvalidCrosswordError("Todas las palabras deben formar un único grafo conectado");
  }
}

function assertNumbering(
  crossword: CrosswordPublicPayload,
  entryStarts: ReadonlyMap<string, CrosswordCellPublic>,
) {
  const starts = new Map<string, CrosswordCellPublic>();
  for (const start of entryStarts.values())
    starts.set(coordinateKey(start.row, start.column), start);
  const ordered = [...starts.values()].sort((left, right) =>
    left.row === right.row ? left.column - right.column : left.row - right.row,
  );
  const expected = new Map(ordered.map((cell, index) => [cell.id, index + 1]));
  for (const cell of crossword.cells) {
    if (cell.number !== expected.get(cell.id)) {
      throw new InvalidCrosswordError("La numeración debe seguir el orden fila/columna");
    }
  }
  for (const entry of crossword.entries) {
    if (entry.number !== expected.get(entryStarts.get(entry.id)!.id)) {
      throw new InvalidCrosswordError("La pista debe usar el número de su celda inicial");
    }
  }
}

function assertSolution(crossword: CrosswordPublicPayload, solution: CrosswordPrivateSolution) {
  if (solution.entries.length !== crossword.entries.length) {
    throw new InvalidCrosswordError("Cada palabra necesita exactamente una solución");
  }
  solutionLetters(crossword, solution);
}

function solutionLetters(
  crossword: CrosswordPublicPayload,
  solution: CrosswordPrivateSolution,
): Map<string, string> {
  const solutionByEntry = new Map(solution.entries.map((entry) => [entry.entryId, entry.answer]));
  if (solutionByEntry.size !== solution.entries.length) {
    throw new InvalidCrosswordError("ID de solución duplicado");
  }
  const letters = new Map<string, string>();
  for (const entry of crossword.entries) {
    const answer = solutionByEntry.get(entry.id);
    const answerLetters = answer ? Array.from(answer.normalize("NFC")) : [];
    if (answerLetters.length !== entry.cellIds.length) {
      throw new InvalidCrosswordError("La solución no coincide con la longitud de la palabra");
    }
    answerLetters.forEach((rawLetter, index) => {
      const letter = normalizeCrosswordLetter(rawLetter);
      if (!letter) throw new InvalidCrosswordError("La solución solo puede contener letras");
      const cellId = entry.cellIds[index]!;
      const previous = letters.get(cellId);
      if (previous && foldCrosswordLetter(previous) !== foldCrosswordLetter(letter)) {
        throw new InvalidCrosswordError("Las letras de un cruce no coinciden");
      }
      letters.set(cellId, letter);
    });
  }
  if (letters.size !== crossword.cells.length) {
    throw new InvalidCrosswordError("La solución debe cubrir todas las celdas");
  }
  return letters;
}

function coordinateKey(row: number, column: number) {
  return `${row}:${column}`;
}

export class InvalidCrosswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCrosswordError";
  }
}
