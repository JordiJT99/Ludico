import type { QuizPublicPayload } from "@ludico/contracts";
import {
  constructCrossword,
  constructWordSearch,
  type GeneratedContentCandidate,
  type WordBankEntry,
} from "@ludico/domain";
import type { ContentAssurancePort, ContentGeneratorPort } from "./content-jobs.js";

export const deterministicContentAssurance: ContentAssurancePort = {
  async evaluate() {
    return true;
  },
  async verifySources() {
    return true;
  },
};

export const deterministicContentGenerator: ContentGeneratorPort = {
  async generate(job) {
    return {
      candidate: fakeCandidate(
        job.contentType,
        job.targetDate,
        job.promptVersion,
        job.targetDifficulty,
      ),
      costMicros: 0,
      origin: "curated" as const,
    };
  },
};

function fakeCandidate(
  type: GeneratedContentCandidate["type"],
  targetDate: string,
  promptVersion: string,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
) {
  switch (type) {
    case "quiz":
      return fakeQuiz(targetDate, promptVersion, targetDifficulty);
    case "crossword":
      return fakeCrossword(targetDate, promptVersion, targetDifficulty);
    case "true_false":
      return fakeTrueFalse(targetDate, promptVersion, targetDifficulty);
    case "guess_word":
      return fakeGuessWord(targetDate, promptVersion, targetDifficulty);
    case "word_search":
      return fakeWordSearch(targetDate, promptVersion, targetDifficulty);
  }
}

function fakeQuiz(targetDate: string, promptVersion: string, targetDifficulty: 1 | 2 | 3 | 4 | 5) {
  const selected = cyclic(
    quizFacts.filter((fact) => quizDifficultyLevel(fact.difficulty) === targetDifficulty),
    targetDate,
    5,
  );
  const questions: QuizPublicPayload["questions"] = selected.map((fact, index) => ({
    id: uuid(targetDate, 100 + index),
    prompt: fact.prompt,
    category: fact.category,
    difficulty: fact.difficulty,
    options: positionedOptions(fact.options, fact.correctIndex, index % 4).map((text, option) => ({
      id: uuid(targetDate, 200 + index * 4 + option),
      text,
    })),
  }));
  return {
    type: "quiz" as const,
    publicPayload: {
      kind: "quiz" as const,
      questions,
      title: `Quiz diario ${label(targetDate, promptVersion)}`,
    },
    privatePayload: {
      kind: "quiz-solution" as const,
      questions: questions.map((question, index) => ({
        correctOptionId: question.options[index % 4]!.id,
        explanation: selected[index]!.explanation,
        questionId: question.id,
      })),
    },
    sources: questions.map((question, index) => ({
      itemId: question.id,
      url: selected[index]!.sourceUrl,
    })),
  };
}

function fakeCrossword(
  targetDate: string,
  promptVersion: string,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
) {
  return constructCrossword(
    cyclic(crosswordBanks, targetDate, 1)[0]!.map((entry) => ({
      ...entry,
      difficulty: targetDifficulty,
    })),
    {
      entryCount: 3,
      seed: label(targetDate, promptVersion),
      targetDifficulty,
      title: `Crucigrama diario ${label(targetDate, promptVersion)}`,
      vocabularyVersion: "curated-v1",
    },
  );
}

function fakeTrueFalse(
  targetDate: string,
  promptVersion: string,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
): GeneratedContentCandidate {
  const items = cyclic(
    trueFalseFacts.filter((item) => item.difficulty === targetDifficulty),
    targetDate,
    5,
  );
  return {
    type: "true_false",
    publicPayload: {
      items: items.map((item, index) => ({
        category: item.category,
        difficulty: item.difficulty,
        id: uuid(targetDate, 300 + index),
        statement: item.statement,
      })),
      kind: "true-false",
      title: `Verdadero o falso diario ${label(targetDate, promptVersion)}`,
    },
    privatePayload: {
      items: items.map((item, index) => ({
        explanation: item.explanation,
        id: uuid(targetDate, 300 + index),
        value: item.value,
      })),
      kind: "true-false-solution",
    },
    sources: items.map((item, index) => ({
      itemId: uuid(targetDate, 300 + index),
      url: item.sourceUrl,
    })),
  };
}

function fakeGuessWord(
  targetDate: string,
  promptVersion: string,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
): GeneratedContentCandidate {
  const id = uuid(targetDate, 400);
  const game = cyclic(
    guessWords.filter((item) => item.difficulty === targetDifficulty),
    targetDate,
    1,
  )[0]!;
  return {
    type: "guess_word",
    publicPayload: {
      allowedCharacters: [...new Set(game.answer)],
      category: game.category,
      definition: game.definition,
      difficulty: game.difficulty,
      hints: game.hints,
      id,
      kind: "guess-word",
      maxAttempts: game.maxAttempts,
      title: `Adivina la palabra diaria ${label(targetDate, promptVersion)}`,
    },
    privatePayload: {
      alternativeAnswers: game.alternativeAnswers,
      answer: game.answer,
      kind: "guess-word-solution",
    },
    sources: [{ itemId: id, url: game.sourceUrl }],
  };
}

function fakeWordSearch(
  targetDate: string,
  promptVersion: string,
  targetDifficulty: 1 | 2 | 3 | 4 | 5,
): GeneratedContentCandidate {
  const words = cyclicDaily(wordSearchWords, targetDate, 5);
  const game = constructWordSearch({
    columns: 8,
    directions: ["east", "south", "southEast"],
    rows: 8,
    seed: label(targetDate, promptVersion),
    words,
  });
  return {
    type: "word_search",
    publicPayload: {
      columns: game.columns,
      difficulty: targetDifficulty,
      grid: game.grid,
      kind: "word-search",
      rows: game.rows,
      seed: game.seed,
      title: `Sopa de letras diaria ${label(targetDate, promptVersion)}`,
      words: game.entries.map((entry, index) => ({
        answer: entry.answer,
        id: uuid(targetDate, 500 + index),
      })),
    },
    privatePayload: { entries: game.entries, kind: "word-search-solution" },
    sources: game.entries.map((_, index) => ({
      itemId: uuid(targetDate, 500 + index),
      url: "https://dle.rae.es/",
    })),
  };
}

const quizFacts = [
  fact(
    "Ciencia",
    "easy",
    "¿Qué planeta es conocido como el planeta rojo?",
    ["Marte", "Venus", "Júpiter", "Mercurio"],
    0,
    "Marte recibe ese apodo por el óxido de hierro presente en su superficie.",
    "https://science.nasa.gov/mars/",
  ),
  fact(
    "Geografía",
    "easy",
    "¿Cuál es el océano más extenso de la Tierra?",
    ["Atlántico", "Índico", "Pacífico", "Ártico"],
    2,
    "El Pacífico es el océano de mayor superficie.",
    "https://oceanservice.noaa.gov/facts/largest-ocean.html",
  ),
  fact(
    "Literatura",
    "medium",
    "¿Quién escribió Don Quijote de la Mancha?",
    ["Lope de Vega", "Miguel de Cervantes", "Benito Pérez Galdós", "Federico García Lorca"],
    1,
    "Miguel de Cervantes publicó la primera parte de Don Quijote en 1605.",
    "https://www.cervantes.es/",
  ),
  fact(
    "Naturaleza",
    "easy",
    "¿Qué gas absorben las plantas durante la fotosíntesis?",
    ["Oxígeno", "Dióxido de carbono", "Helio", "Nitrógeno"],
    1,
    "Las plantas usan dióxido de carbono y liberan oxígeno durante la fotosíntesis.",
    "https://science.nasa.gov/earth/",
  ),
  fact(
    "Historia",
    "easy",
    "¿En qué país se encuentran las pirámides de Guiza?",
    ["México", "Egipto", "Grecia", "Perú"],
    1,
    "Las pirámides de Guiza se encuentran cerca de El Cairo, en Egipto.",
    "https://whc.unesco.org/en/list/86/",
  ),
  fact(
    "Música",
    "easy",
    "¿Cuántas notas tiene la escala musical tradicional?",
    ["Cinco", "Seis", "Siete", "Ocho"],
    2,
    "La escala diatónica tradicional usa siete notas con nombre.",
    "https://www.britannica.com/art/musical-scale",
  ),
  fact(
    "Ciencia",
    "medium",
    "¿Cuál es el símbolo químico del oro?",
    ["Ag", "Au", "O", "Fe"],
    1,
    "El símbolo Au procede del nombre latino del oro: aurum.",
    "https://www.rsc.org/periodic-table/element/79/gold",
  ),
  fact(
    "Geografía",
    "easy",
    "¿Cuál es la capital de Italia?",
    ["Milán", "Roma", "Nápoles", "Turín"],
    1,
    "Roma es la capital de Italia.",
    "https://www.italia.it/es",
  ),
  fact(
    "Cine",
    "easy",
    "¿Qué tipo de obra se proyecta habitualmente en una sala de cine?",
    ["Una película", "Una novela", "Un mapa", "Una escultura"],
    0,
    "El cine proyecta obras audiovisuales, normalmente películas.",
    "https://www.britannica.com/art/motion-picture",
  ),
  fact(
    "Naturaleza",
    "easy",
    "¿Qué animal es un mamífero?",
    ["Tiburón", "Lagarto", "Murciélago", "Trucha"],
    2,
    "Los murciélagos son mamíferos, aunque vuelen.",
    "https://www.britannica.com/animal/bat-mammal",
  ),
  fact(
    "Tecnología",
    "easy",
    "¿Qué dispositivo se utiliza habitualmente para escribir en un ordenador?",
    ["Teclado", "Brújula", "Termómetro", "Prisma"],
    0,
    "El teclado permite introducir texto y órdenes en un ordenador.",
    "https://www.britannica.com/technology/computer-keyboard",
  ),
  fact(
    "España",
    "easy",
    "¿Qué ciudad es la capital de España?",
    ["Barcelona", "Sevilla", "Madrid", "Valencia"],
    2,
    "Madrid es la capital de España.",
    "https://www.lamoncloa.gob.es/espana/",
  ),
] as const;

const trueFalseFacts = [
  trueFalse(
    "La Tierra gira alrededor del Sol.",
    true,
    "La Tierra completa una órbita alrededor del Sol cada año.",
    "Ciencia",
    1,
    "https://science.nasa.gov/earth/",
  ),
  trueFalse(
    "La Luna es un planeta.",
    false,
    "La Luna es el satélite natural de la Tierra.",
    "Ciencia",
    1,
    "https://science.nasa.gov/moon/",
  ),
  trueFalse(
    "El agua está formada por hidrógeno y oxígeno.",
    true,
    "La fórmula química del agua es H₂O.",
    "Ciencia",
    1,
    "https://www.usgs.gov/special-topics/water-science-school/science/water-properties",
  ),
  trueFalse(
    "Los murciélagos son mamíferos.",
    true,
    "Los murciélagos pertenecen al grupo de los mamíferos.",
    "Naturaleza",
    1,
    "https://www.britannica.com/animal/bat-mammal",
  ),
  trueFalse(
    "El Sol gira alrededor de la Tierra.",
    false,
    "La Tierra orbita alrededor del Sol.",
    "Ciencia",
    1,
    "https://science.nasa.gov/sun/",
  ),
  trueFalse(
    "Roma es la capital de Italia.",
    true,
    "Roma es la capital italiana.",
    "Geografía",
    1,
    "https://www.italia.it/es",
  ),
  trueFalse(
    "El océano Pacífico es más pequeño que el Ártico.",
    false,
    "El Pacífico es el océano más extenso de la Tierra.",
    "Geografía",
    1,
    "https://oceanservice.noaa.gov/facts/largest-ocean.html",
  ),
  trueFalse(
    "La luz viaja más rápido que el sonido en el aire.",
    true,
    "La luz llega antes que el sonido en fenómenos como los relámpagos.",
    "Ciencia",
    2,
    "https://www.nist.gov/pml/speed-light",
  ),
  trueFalse(
    "Cervantes escribió Don Quijote de la Mancha.",
    true,
    "Miguel de Cervantes es el autor de Don Quijote.",
    "Literatura",
    1,
    "https://www.cervantes.es/",
  ),
  trueFalse(
    "Un triángulo tiene cuatro lados.",
    false,
    "Un triángulo tiene exactamente tres lados.",
    "Matemáticas",
    1,
    "https://www.britannica.com/science/triangle",
  ),
] as const;

const guessWords = [
  guessWord(
    "ARBOL",
    "Naturaleza",
    "Planta leñosa con tronco y copa.",
    2,
    ["Tiene raíces.", 1],
    "https://dle.rae.es/árbol",
  ),
  guessWord(
    "LUNA",
    "Ciencia",
    "Satélite natural que orbita la Tierra.",
    1,
    ["Se ve en el cielo nocturno.", 1],
    "https://science.nasa.gov/moon/",
  ),
  guessWord(
    "LIBRO",
    "Cultura",
    "Conjunto de páginas encuadernadas que se leen.",
    1,
    ["Puede contener una historia.", 1],
    "https://dle.rae.es/libro",
  ),
  guessWord(
    "BRUJULA",
    "Geografía",
    "Instrumento que señala el norte magnético.",
    2,
    ["Se usa para orientarse.", 1],
    "https://dle.rae.es/brújula",
  ),
  guessWord(
    "VOLCAN",
    "Naturaleza",
    "Abertura de la corteza terrestre que expulsa materiales del interior.",
    3,
    ["Puede expulsar lava.", 1],
    "https://www.usgs.gov/programs/VHP",
  ),
  guessWord(
    "MUSICA",
    "Cultura",
    "Arte de organizar sonidos y silencios.",
    1,
    ["Se puede escuchar.", 1],
    "https://dle.rae.es/música",
  ),
  guessWord(
    "PLANETA",
    "Ciencia",
    "Cuerpo celeste que gira alrededor de una estrella.",
    2,
    ["La Tierra es uno.", 1],
    "https://science.nasa.gov/solar-system/",
  ),
  guessWord(
    "MAPA",
    "Geografía",
    "Representación gráfica y reducida de un territorio.",
    1,
    ["Ayuda a encontrar lugares.", 1],
    "https://dle.rae.es/mapa",
  ),
  guessWord(
    "CASA",
    "Vida cotidiana",
    "Edificio o lugar destinado a vivir.",
    1,
    ["Tiene habitaciones.", 1],
    "https://dle.rae.es/casa",
  ),
  guessWord(
    "MESA",
    "Vida cotidiana",
    "Mueble con una superficie horizontal para apoyar objetos.",
    1,
    ["Puede tener cuatro patas.", 1],
    "https://dle.rae.es/mesa",
  ),
  guessWord(
    "PERRO",
    "Naturaleza",
    "Mamífero doméstico conocido por sus ladridos.",
    1,
    ["Suele ser una mascota.", 1],
    "https://dle.rae.es/perro",
  ),
  guessWord(
    "GATO",
    "Naturaleza",
    "Mamífero doméstico que maúlla.",
    1,
    ["Puede tener bigotes.", 1],
    "https://dle.rae.es/gato",
  ),
  guessWord(
    "PAN",
    "Gastronomía",
    "Alimento elaborado principalmente con harina y agua.",
    1,
    ["Se come en rebanadas.", 1],
    "https://dle.rae.es/pan",
  ),
  guessWord(
    "RELOJ",
    "Vida cotidiana",
    "Instrumento que sirve para medir o indicar la hora.",
    1,
    ["Puede tener agujas.", 1],
    "https://dle.rae.es/reloj",
  ),
  guessWord(
    "NUBE",
    "Naturaleza",
    "Masa visible de gotas de agua o cristales de hielo en el cielo.",
    1,
    ["Puede anunciar lluvia.", 1],
    "https://dle.rae.es/nube",
  ),
  guessWord(
    "PUENTE",
    "Geografía",
    "Construcción que permite salvar un río, una vía o un desnivel.",
    1,
    ["Sirve para cruzar un obstáculo.", 1],
    "https://dle.rae.es/puente",
  ),
  guessWord(
    "BOSQUE",
    "Naturaleza",
    "Terreno poblado principalmente por árboles.",
    1,
    ["En él crecen muchos árboles.", 1],
    "https://dle.rae.es/bosque",
  ),
  guessWord(
    "VENTANA",
    "Vida cotidiana",
    "Abertura en una pared que deja pasar luz y aire.",
    1,
    ["Puede tener cristales.", 1],
    "https://dle.rae.es/ventana",
  ),
] as const;

const wordSearchWords = [
  "SOL",
  "LUNA",
  "NUBE",
  "ARCO",
  "RIO",
  "FLOR",
  "LIBRO",
  "MAPA",
  "TIERRA",
  "MAR",
  "ROSA",
  "AZUL",
  "VERDE",
  "NORTE",
  "SUR",
  "ESTRELLA",
  "CASA",
  "MESA",
  "PERRO",
  "GATO",
  "PAN",
  "RELOJ",
  "BOSQUE",
  "PUENTE",
  "VENTANA",
  "CAMINO",
  "TREN",
  "AVION",
  "BARCO",
  "PLAYA",
  "LAGO",
  "ISLA",
  "LLUVIA",
  "VIENTO",
  "FUEGO",
  "NIEVE",
  "CAMPO",
  "CIELO",
  "NOCHE",
  "DIA",
  "FRUTA",
  "MANZANA",
  "UVA",
  "QUESO",
  "LECHE",
  "CAFE",
  "PLATO",
  "CUCHARA",
  "ESCUELA",
  "MUSICA",
  "PINTURA",
  "TEATRO",
  "CIENCIA",
  "NUMERO",
  "LETRA",
  "CUENTO",
  "JUEGO",
  "PELOTA",
  "RAQUETA",
  "JARDIN",
  "SEMILLA",
  "ABEJA",
  "MARIPOSA",
  "NARANJA",
  "LIMON",
  "TOMATE",
  "PATATA",
  "AZUCAR",
  "CEREZA",
  "CONEJO",
];

const crosswordBanks: readonly (readonly WordBankEntry[])[] = [
  [
    word("sol", "SOL", "Estrella del sistema solar"),
    word("sal", "SAL", "Condimento mineral"),
    word("luz", "LUZ", "Claridad que permite ver"),
    word("sur", "SUR", "Punto cardinal opuesto al norte"),
    word("riel", "RIEL", "Barra de una vía férrea"),
  ],
  [
    word("sol", "SOL", "Astro que ilumina el día"),
    word("sal", "SAL", "Sustancia que sazona alimentos"),
    word("luz", "LUZ", "Energía visible"),
    word("sur", "SUR", "Dirección hacia el polo austral"),
    word("riel", "RIEL", "Carril de tren"),
  ],
  [
    word("sol", "SOL", "Centro de nuestro sistema planetario"),
    word("sal", "SAL", "Producto que se disuelve en agua"),
    word("luz", "LUZ", "Brillo de una lámpara"),
    word("sur", "SUR", "Uno de los cuatro puntos cardinales"),
    word("riel", "RIEL", "Pieza metálica para trenes"),
  ],
];

function word(id: string, answer: string, clue: string): WordBankEntry {
  return { answer, clue, id, sourceUrl: "https://dle.rae.es/" };
}

function fact(
  category: string,
  difficulty: "easy" | "medium",
  prompt: string,
  options: readonly [string, string, string, string],
  correctIndex: number,
  explanation: string,
  sourceUrl: string,
) {
  return { category, difficulty, prompt, options, correctIndex, explanation, sourceUrl };
}

function quizDifficultyLevel(difficulty: "easy" | "medium"): 2 | 3 {
  return difficulty === "easy" ? 2 : 3;
}

function trueFalse(
  statement: string,
  value: boolean,
  explanation: string,
  category: string,
  difficulty: 1 | 2,
  sourceUrl: string,
) {
  return { statement, value, explanation, category, difficulty, sourceUrl };
}

function guessWord(
  answer: string,
  category: string,
  definition: string,
  difficulty: 1 | 2 | 3,
  hints: readonly [string, number],
  sourceUrl: string,
) {
  return {
    alternativeAnswers: [],
    answer,
    category,
    definition,
    difficulty,
    hints: [{ text: hints[0], unlockAfterAttempts: hints[1] }],
    maxAttempts: 5,
    sourceUrl,
  };
}

function cyclic<T>(items: readonly T[], targetDate: string, count: number): readonly T[] {
  const start = Math.abs(Date.parse(`${targetDate}T12:00:00Z`) / 86_400_000) % items.length;
  return Array.from(
    { length: count },
    (_, index) => items[(Math.floor(start) + index) % items.length]!,
  );
}

function cyclicDaily<T>(items: readonly T[], targetDate: string, count: number): readonly T[] {
  const day = Math.floor(Date.parse(`${targetDate}T12:00:00Z`) / 86_400_000);
  const start = Math.abs(day * count) % items.length;
  return Array.from({ length: count }, (_, index) => items[(start + index) % items.length]!);
}

function positionedOptions(
  options: readonly [string, string, string, string],
  correctIndex: number,
  desiredIndex: number,
): readonly string[] {
  const positioned = [...options];
  [positioned[correctIndex], positioned[desiredIndex]] = [
    positioned[desiredIndex]!,
    positioned[correctIndex]!,
  ];
  return positioned;
}

function uuid(targetDate: string, suffix: number): string {
  const date = targetDate.replaceAll("-", "").padEnd(12, "0").slice(0, 12);
  return `${date.slice(0, 8)}-${date.slice(8, 12)}-4000-8000-${suffix.toString().padStart(12, "0")}`;
}

function label(targetDate: string, promptVersion: string): string {
  return promptVersion === "v1" ? targetDate : `${targetDate} ${promptVersion}`;
}
