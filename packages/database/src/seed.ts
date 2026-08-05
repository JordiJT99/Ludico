import type {
  CrosswordPublicPayload,
  GuessWordPublicPayload,
  QuizPublicPayload,
  WordSearchPublicPayload,
} from "@ludico/contracts";
import {
  constructWordSearch,
  type CrosswordPrivateSolution,
  getEditionWindow,
  type QuizPrivateSolution,
  validateCrossword,
  validateQuiz,
} from "@ludico/domain";
import { and, eq, ne } from "drizzle-orm";
import { createDatabase } from "./client.js";
import { dailyEditions, games, gameSolutions } from "./schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL es obligatoria");

const localDate = process.env.SEED_DATE ?? todayInMadrid();
const { opensAt, closesAt } = getEditionWindow(localDate);
const { db, pool } = createDatabase(connectionString);
const quiz = makeQuiz();
const quizSolution = makeQuizSolution();
const crossword = makeCrossword();
const crosswordSolution = makeCrosswordSolution(crossword);
const trueFalse = makeTrueFalse();
const guessWord = makeGuessWord();
const wordSearch = makeWordSearch();
validateQuiz(quiz, quizSolution.questions);
validateCrossword(crossword, crosswordSolution);

try {
  await db
    .insert(dailyEditions)
    .values({
      closesAt,
      localDate,
      opensAt,
      publishedAt: new Date(),
      status: "published",
    })
    .onConflictDoNothing();
  const [edition] = await db
    .select({ id: dailyEditions.id })
    .from(dailyEditions)
    .where(and(eq(dailyEditions.localDate, localDate), ne(dailyEditions.status, "cancelled")))
    .limit(1);
  if (!edition) throw new Error(`No se pudo preparar la edición ${localDate}`);

  await db
    .update(dailyEditions)
    .set({ closesAt, opensAt, publishedAt: new Date(), status: "published" })
    .where(eq(dailyEditions.id, edition.id));
  const [game] = await db
    .insert(games)
    .values({ editionId: edition.id, publicPayload: quiz, status: "active", type: "quiz" })
    .onConflictDoUpdate({
      target: [games.editionId, games.type],
      set: { publicPayload: quiz, status: "active" },
    })
    .returning({ id: games.id });
  if (!game) throw new Error("No se pudo preparar el quiz");

  await db
    .insert(gameSolutions)
    .values({ gameId: game.id, privatePayload: quizSolution })
    .onConflictDoUpdate({
      target: gameSolutions.gameId,
      set: { privatePayload: quizSolution, publicPayload: null, publishedAt: null },
    });

  const [crosswordGame] = await db
    .insert(games)
    .values({
      editionId: edition.id,
      publicPayload: crossword,
      status: "active",
      type: "crossword",
    })
    .onConflictDoUpdate({
      target: [games.editionId, games.type],
      set: { publicPayload: crossword, status: "active" },
    })
    .returning({ id: games.id });
  if (!crosswordGame) throw new Error("No se pudo preparar el crucigrama");
  await db
    .insert(gameSolutions)
    .values({ gameId: crosswordGame.id, privatePayload: crosswordSolution })
    .onConflictDoUpdate({
      target: gameSolutions.gameId,
      set: { privatePayload: crosswordSolution, publicPayload: null, publishedAt: null },
    });

  await seedGame(edition.id, "true_false", trueFalse.payload, trueFalse.solution);
  await seedGame(edition.id, "guess_word", guessWord.payload, guessWord.solution);
  await seedGame(edition.id, "word_search", wordSearch.payload, wordSearch.solution);
  console.log(`Seed publicado para ${localDate}: cinco retos listos.`);
} finally {
  await pool.end();
}

function todayInMadrid(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function makeQuiz(): QuizPublicPayload {
  return {
    kind: "quiz",
    title: "Cinco minutos de curiosidad",
    questions: [
      question(
        "10000000-0000-4000-8000-000000000001",
        "¿Cuál es el planeta más grande del sistema solar?",
        "Ciencia",
        "easy",
        [
          ["11000000-0000-4000-8000-000000000001", "Júpiter"],
          ["11000000-0000-4000-8000-000000000002", "Marte"],
          ["11000000-0000-4000-8000-000000000003", "Venus"],
          ["11000000-0000-4000-8000-000000000004", "Mercurio"],
        ],
      ),
      question(
        "10000000-0000-4000-8000-000000000002",
        "¿Quién escribió La casa de Bernarda Alba?",
        "Literatura",
        "medium",
        [
          ["12000000-0000-4000-8000-000000000001", "Federico García Lorca"],
          ["12000000-0000-4000-8000-000000000002", "Miguel de Unamuno"],
          ["12000000-0000-4000-8000-000000000003", "Carmen Laforet"],
          ["12000000-0000-4000-8000-000000000004", "Antonio Machado"],
        ],
      ),
      question(
        "10000000-0000-4000-8000-000000000003",
        "¿Cuál es la capital de Portugal?",
        "Geografía",
        "easy",
        [
          ["13000000-0000-4000-8000-000000000001", "Lisboa"],
          ["13000000-0000-4000-8000-000000000002", "Oporto"],
          ["13000000-0000-4000-8000-000000000003", "Coímbra"],
          ["13000000-0000-4000-8000-000000000004", "Braga"],
        ],
      ),
      question(
        "10000000-0000-4000-8000-000000000004",
        "¿Qué símbolo químico representa el oro?",
        "Ciencia",
        "medium",
        [
          ["14000000-0000-4000-8000-000000000001", "Au"],
          ["14000000-0000-4000-8000-000000000002", "Ag"],
          ["14000000-0000-4000-8000-000000000003", "Fe"],
          ["14000000-0000-4000-8000-000000000004", "O"],
        ],
      ),
      question(
        "10000000-0000-4000-8000-000000000005",
        "¿Qué océano separa principalmente Europa de América?",
        "Geografía",
        "hard",
        [
          ["15000000-0000-4000-8000-000000000001", "Atlántico"],
          ["15000000-0000-4000-8000-000000000002", "Pacífico"],
          ["15000000-0000-4000-8000-000000000003", "Índico"],
          ["15000000-0000-4000-8000-000000000004", "Ártico"],
        ],
      ),
    ],
  };
}

function question(
  id: string,
  prompt: string,
  category: string,
  difficulty: "easy" | "medium" | "hard",
  options: ReadonlyArray<readonly [string, string]>,
) {
  return {
    category,
    difficulty,
    id,
    options: options.map(([optionId, text]) => ({ id: optionId, text })),
    prompt,
  };
}

function makeQuizSolution(): QuizPrivateSolution {
  return {
    kind: "quiz-solution",
    questions: [
      [
        "10000000-0000-4000-8000-000000000001",
        "11000000-0000-4000-8000-000000000001",
        "Júpiter es el planeta con mayor masa y diámetro del sistema solar.",
      ],
      [
        "10000000-0000-4000-8000-000000000002",
        "12000000-0000-4000-8000-000000000001",
        "Federico García Lorca terminó esta obra teatral en 1936.",
      ],
      [
        "10000000-0000-4000-8000-000000000003",
        "13000000-0000-4000-8000-000000000001",
        "Lisboa es la capital y la ciudad más poblada de Portugal.",
      ],
      [
        "10000000-0000-4000-8000-000000000004",
        "14000000-0000-4000-8000-000000000001",
        "Au procede del nombre latino del oro: aurum.",
      ],
      [
        "10000000-0000-4000-8000-000000000005",
        "15000000-0000-4000-8000-000000000001",
        "El océano Atlántico se extiende entre América y Europa y África.",
      ],
    ].map(([questionId, correctOptionId, explanation]) => ({
      correctOptionId: correctOptionId!,
      explanation: explanation!,
      questionId: questionId!,
    })),
  };
}

function makeCrossword(): CrosswordPublicPayload {
  const positions = [
    [0, 2, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [2, 0, 2],
    [2, 1],
    [2, 3],
    [2, 4],
  ] as const;
  const cells = positions.map(([row, column, number], index) => ({
    column,
    id: `c0000000-0000-4000-8000-00000000000${index}`,
    ...(number ? { number } : {}),
    row,
  }));
  const open = new Set(cells.map((cell) => `${cell.row}:${cell.column}`));
  const blocks = Array.from({ length: 25 }, (_, index) => ({
    column: index % 5,
    row: Math.floor(index / 5),
  })).filter(({ row, column }) => !open.has(`${row}:${column}`));
  return {
    blocks,
    cells,
    columns: 5,
    entries: [
      {
        cellIds: cells.slice(0, 5).map(({ id }) => id),
        clue: "Conocer o tener noticia de algo",
        direction: "down",
        id: "d0000000-0000-4000-8000-000000000001",
        number: 1,
      },
      {
        cellIds: [cells[5]!.id, cells[6]!.id, cells[2]!.id, cells[7]!.id, cells[8]!.id],
        clue: "Masas visibles de vapor de agua",
        direction: "across",
        id: "d0000000-0000-4000-8000-000000000002",
        number: 2,
      },
    ],
    kind: "crossword",
    rows: 5,
    rules: { accentPolicy: "fold" },
    title: "Cruce de palabras",
  };
}

function makeCrosswordSolution(crossword: CrosswordPublicPayload): CrosswordPrivateSolution {
  return {
    entries: [
      { answer: "SABER", entryId: crossword.entries[0]!.id },
      { answer: "NUBES", entryId: crossword.entries[1]!.id },
    ],
    kind: "crossword-solution",
    uniqueness: { alternativeCount: 1, vocabularyVersion: "seed-es-v1" },
  };
}

function makeTrueFalse(): { payload: QuizPublicPayload; solution: QuizPrivateSolution } {
  const statements = [
    ["La Tierra gira alrededor del Sol.", true],
    ["La Luna es un planeta.", false],
    ["El agua contiene hidrógeno y oxígeno.", true],
    ["Los murciélagos son reptiles.", false],
    ["El Sol es una estrella.", true],
  ] as const;
  const questions = statements.map(([prompt], index) => ({
    category: "Ciencia",
    difficulty: "easy" as const,
    id: `30000000-0000-4000-8000-00000000000${index + 1}`,
    options: [
      { id: `31000000-0000-4000-8000-00000000000${index}1`, text: "Verdadero" },
      { id: `31000000-0000-4000-8000-00000000000${index}2`, text: "Falso" },
    ],
    prompt,
  }));
  return {
    payload: { kind: "quiz", questions, title: "Verdadero o falso" },
    solution: {
      kind: "quiz-solution",
      questions: questions.map((question, index) => ({
        correctOptionId: question.options[statements[index]![1] ? 0 : 1]!.id,
        explanation: "Explicación incluida en la solución de esta afirmación.",
        questionId: question.id,
      })),
    },
  };
}

function makeGuessWord(): { payload: GuessWordPublicPayload; solution: unknown } {
  return {
    payload: {
      allowedCharacters: Array.from("ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"),
      category: "Naturaleza",
      definition: "Planta leñosa con tronco y copa de ramas.",
      difficulty: 1,
      hints: [{ text: "Puede dar sombra.", unlockAfterAttempts: 1 }],
      id: "40000000-0000-4000-8000-000000000001",
      kind: "guess-word",
      maxAttempts: 5,
      title: "Adivina la palabra",
    },
    solution: { alternativeAnswers: [], answer: "ARBOL", kind: "guess-word-solution" },
  };
}

function makeWordSearch(): { payload: WordSearchPublicPayload; solution: unknown } {
  const game = constructWordSearch({
    columns: 8,
    directions: ["east", "south", "southEast"],
    rows: 8,
    seed: `seed-${localDate}`,
    words: ["SOL", "LUNA", "NUBE"],
  });
  return {
    payload: {
      columns: game.columns,
      grid: game.grid,
      kind: "word-search",
      rows: game.rows,
      seed: game.seed,
      title: "Sopa de letras",
      words: game.entries.map((entry, index) => ({
        answer: entry.answer,
        id: `50000000-0000-4000-8000-00000000000${index + 1}`,
      })),
    },
    solution: { entries: game.entries, kind: "word-search-solution" },
  };
}

async function seedGame(
  editionId: string,
  type: "true_false" | "guess_word" | "word_search",
  publicPayload: unknown,
  privatePayload: unknown,
) {
  const [game] = await db
    .insert(games)
    .values({ editionId, publicPayload, status: "active", type })
    .onConflictDoUpdate({
      target: [games.editionId, games.type],
      set: { publicPayload, status: "active" },
    })
    .returning({ id: games.id });
  if (!game) throw new Error(`No se pudo preparar ${type}`);
  await db
    .insert(gameSolutions)
    .values({ gameId: game.id, privatePayload })
    .onConflictDoUpdate({
      target: gameSolutions.gameId,
      set: { privatePayload, publicPayload: null, publishedAt: null },
    });
}
