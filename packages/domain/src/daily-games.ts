import { foldCrosswordLetter } from "./crossword.js";

export type GameDifficulty = 1 | 2 | 3 | 4 | 5;
export type WordSearchDirection =
  "east" | "west" | "north" | "south" | "northEast" | "northWest" | "southEast" | "southWest";

export interface TrueFalseItem {
  readonly category: string;
  readonly difficulty: GameDifficulty;
  readonly explanation: string;
  readonly sourceUrl: string;
  readonly statement: string;
  readonly value: boolean;
}

export interface GuessWordGame {
  readonly allowedCharacters: readonly string[];
  readonly alternativeAnswers: readonly string[];
  readonly answer: string;
  readonly category: string;
  readonly definition: string;
  readonly difficulty: GameDifficulty;
  readonly hints: readonly { readonly text: string; readonly unlockAfterAttempts: number }[];
  readonly maxAttempts: number;
}

export interface WordSearchEntry {
  readonly answer: string;
  readonly column: number;
  readonly direction: WordSearchDirection;
  readonly row: number;
}

export interface WordSearchGame {
  readonly columns: number;
  readonly entries: readonly WordSearchEntry[];
  readonly grid: readonly (readonly string[])[];
  readonly rows: number;
  readonly seed: string;
}

export interface WordSearchConfig {
  readonly columns: number;
  readonly directions: readonly WordSearchDirection[];
  readonly rows: number;
  readonly seed: string;
  readonly words: readonly string[];
}

export class DailyGameValidationError extends Error {
  constructor(
    readonly code:
      "INVALID_GUESS_WORD" | "INVALID_TRUE_FALSE" | "INVALID_WORD_SEARCH" | "NO_LAYOUT",
  ) {
    super(code);
    this.name = "DailyGameValidationError";
  }
}

export function validateTrueFalse(items: readonly TrueFalseItem[]): void {
  if (items.length < 3 || items.length > 20)
    throw new DailyGameValidationError("INVALID_TRUE_FALSE");
  const statements = new Set<string>();
  let trueCount = 0;
  for (const item of items) {
    const statement = normalizedText(item.statement);
    const duplicateStatement = statements.has(statement);
    statements.add(statement);
    if (
      statement.length < 8 ||
      duplicateStatement ||
      item.explanation.trim().length < 12 ||
      item.category.trim().length < 2 ||
      !isDifficulty(item.difficulty) ||
      !isHttps(item.sourceUrl)
    ) {
      throw new DailyGameValidationError("INVALID_TRUE_FALSE");
    }
    if (item.value) trueCount += 1;
  }
  if (trueCount === 0 || trueCount === items.length) {
    throw new DailyGameValidationError("INVALID_TRUE_FALSE");
  }
}

export function validateGuessWord(game: GuessWordGame): void {
  const answer = normalizedAnswer(game.answer);
  const alternatives = new Set(game.alternativeAnswers.map(normalizedAnswer));
  const characters = new Set(
    game.allowedCharacters.map((character) => normalizeCharacter(character)),
  );
  if (
    answer.length < 3 ||
    answer.length > 21 ||
    game.definition.trim().length < 12 ||
    game.category.trim().length < 2 ||
    !isDifficulty(game.difficulty) ||
    !Number.isInteger(game.maxAttempts) ||
    game.maxAttempts < 1 ||
    game.maxAttempts > 12 ||
    game.hints.length < 1 ||
    game.hints.length > 5 ||
    characters.size === 0 ||
    [...characters].some((character) => character === null) ||
    [...answer].some((letter) => !characters.has(letter)) ||
    alternatives.has(answer) ||
    game.hints.some(
      (hint, index) =>
        hint.text.trim().length < 3 ||
        !Number.isInteger(hint.unlockAfterAttempts) ||
        hint.unlockAfterAttempts < 0 ||
        hint.unlockAfterAttempts > game.maxAttempts ||
        (index > 0 && hint.unlockAfterAttempts < game.hints[index - 1]!.unlockAfterAttempts),
    )
  ) {
    throw new DailyGameValidationError("INVALID_GUESS_WORD");
  }
}

export function constructWordSearch(config: WordSearchConfig): WordSearchGame {
  if (
    !config.seed ||
    !Number.isInteger(config.rows) ||
    !Number.isInteger(config.columns) ||
    config.rows < 4 ||
    config.rows > 21 ||
    config.columns < 4 ||
    config.columns > 21 ||
    config.directions.length === 0 ||
    config.words.length < 3 ||
    config.words.length > 40
  ) {
    throw new DailyGameValidationError("INVALID_WORD_SEARCH");
  }
  const words = config.words.map(normalizedAnswer);
  if (new Set(words).size !== words.length || words.some((word) => word.length > 21)) {
    throw new DailyGameValidationError("INVALID_WORD_SEARCH");
  }
  const grid = Array.from({ length: config.rows }, () => Array<string>(config.columns).fill(""));
  const entries: WordSearchEntry[] = [];
  const random = seededRandom(config.seed);
  for (const answer of [...words].sort(
    (left, right) => right.length - left.length || left.localeCompare(right),
  )) {
    const candidates = placementsFor(answer, config.rows, config.columns, config.directions)
      .filter((placement) => fitsWord(grid, answer, placement))
      .sort((left, right) => random() - 0.5 || left.row - right.row || left.column - right.column);
    const placement = candidates[0];
    if (!placement) throw new DailyGameValidationError("NO_LAYOUT");
    placeWord(grid, answer, placement);
    entries.push({ answer, ...placement });
  }
  const alphabet = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  for (const row of grid) {
    for (let column = 0; column < row.length; column += 1) {
      if (!row[column]) row[column] = alphabet[Math.floor(random() * alphabet.length)]!;
    }
  }
  const game = { columns: config.columns, entries, grid, rows: config.rows, seed: config.seed };
  validateWordSearch(game);
  return game;
}

export function validateWordSearch(game: WordSearchGame): void {
  if (
    !game.seed ||
    game.rows < 4 ||
    game.columns < 4 ||
    game.grid.length !== game.rows ||
    game.grid.some(
      (row) => row.length !== game.columns || row.some((letter) => !/^[A-ZÑ]$/u.test(letter)),
    ) ||
    game.entries.length < 3
  ) {
    throw new DailyGameValidationError("INVALID_WORD_SEARCH");
  }
  const answers = new Set<string>();
  for (const entry of game.entries) {
    const duplicateAnswer = answers.has(entry.answer);
    answers.add(entry.answer);
    if (
      duplicateAnswer ||
      !placementsFor(entry.answer, game.rows, game.columns, [entry.direction]).some(
        (placement) => placement.row === entry.row && placement.column === entry.column,
      )
    ) {
      throw new DailyGameValidationError("INVALID_WORD_SEARCH");
    }
    const vector = vectors[entry.direction];
    const letters = Array.from(entry.answer).map(
      (_, index) =>
        game.grid[entry.row + vector.row * index]?.[entry.column + vector.column * index],
    );
    if (letters.join("") !== entry.answer)
      throw new DailyGameValidationError("INVALID_WORD_SEARCH");
  }
}

const vectors: Readonly<Record<WordSearchDirection, { column: number; row: number }>> = {
  east: { column: 1, row: 0 },
  north: { column: 0, row: -1 },
  northEast: { column: 1, row: -1 },
  northWest: { column: -1, row: -1 },
  south: { column: 0, row: 1 },
  southEast: { column: 1, row: 1 },
  southWest: { column: -1, row: 1 },
  west: { column: -1, row: 0 },
};

function placementsFor(
  answer: string,
  rows: number,
  columns: number,
  directions: readonly WordSearchDirection[],
) {
  const placements: { column: number; direction: WordSearchDirection; row: number }[] = [];
  for (const direction of directions) {
    const vector = vectors[direction];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const endRow = row + vector.row * (answer.length - 1);
        const endColumn = column + vector.column * (answer.length - 1);
        if (endRow >= 0 && endRow < rows && endColumn >= 0 && endColumn < columns) {
          placements.push({ column, direction, row });
        }
      }
    }
  }
  return placements;
}

function fitsWord(
  grid: readonly (readonly string[])[],
  answer: string,
  placement: { column: number; direction: WordSearchDirection; row: number },
): boolean {
  const vector = vectors[placement.direction];
  return Array.from(answer).every((letter, index) => {
    const current =
      grid[placement.row + vector.row * index]![placement.column + vector.column * index]!;
    return !current || current === letter;
  });
}

function placeWord(
  grid: string[][],
  answer: string,
  placement: { column: number; direction: WordSearchDirection; row: number },
): void {
  const vector = vectors[placement.direction];
  Array.from(answer).forEach((letter, index) => {
    grid[placement.row + vector.row * index]![placement.column + vector.column * index] = letter;
  });
}

function normalizedAnswer(value: string): string {
  const normalized = foldCrosswordLetter(value.trim());
  if (!/^[A-ZÑ]{3,21}$/u.test(normalized)) throw new DailyGameValidationError("INVALID_GUESS_WORD");
  return normalized;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCharacter(value: string): string | null {
  const normalized = foldCrosswordLetter(value);
  return /^[A-ZÑ]$/u.test(normalized) ? normalized : null;
}

function isDifficulty(value: number): value is GameDifficulty {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function seededRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (const character of seed) state = Math.imul(state ^ character.codePointAt(0)!, 16_777_619);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}
