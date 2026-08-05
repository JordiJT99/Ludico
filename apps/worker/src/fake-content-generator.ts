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
  const selected = cyclicDaily(
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
  const items = cyclicDaily(
    allTrueFalseFacts.filter((item) => item.difficulty === targetDifficulty),
    targetDate,
    3,
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
    allGuessWords.filter((item) => item.difficulty === targetDifficulty),
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
  const config = wordSearchDifficultyConfig[targetDifficulty];
  const words = cyclicDaily(
    wordSearchWords.filter((word) => word.length <= Math.min(config.rows, config.columns)),
    targetDate,
    config.wordCount,
  );
  const game = constructWordSearch({
    columns: config.columns,
    directions: config.directions,
    rows: config.rows,
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

const baseQuizFacts = [
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

const additionalQuizFacts = [
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Portugal?",
    ["Lisboa", "Oporto", "Coímbra", "Faro"],
    "Lisboa es la capital portuguesa.",
    "https://www.britannica.com/place/Lisbon",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Japón?",
    ["Tokio", "Kioto", "Osaka", "Nara"],
    "Tokio es la capital de Japón.",
    "https://www.britannica.com/place/Tokyo",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Canadá?",
    ["Ottawa", "Toronto", "Vancouver", "Montreal"],
    "Ottawa es la capital canadiense.",
    "https://www.britannica.com/place/Ottawa",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Australia?",
    ["Canberra", "Sídney", "Melbourne", "Perth"],
    "Canberra es la capital de Australia.",
    "https://www.britannica.com/place/Canberra",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Francia?",
    ["París", "Lyon", "Marsella", "Niza"],
    "París es la capital francesa.",
    "https://www.britannica.com/place/Paris",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Alemania?",
    ["Berlín", "Hamburgo", "Múnich", "Colonia"],
    "Berlín es la capital alemana.",
    "https://www.britannica.com/place/Berlin",
  ),
  easyQuiz(
    "Geografía",
    "¿Cuál es la capital de Brasil?",
    ["Brasilia", "Río de Janeiro", "São Paulo", "Salvador"],
    "Brasilia es la capital federal de Brasil.",
    "https://www.britannica.com/place/Brasilia",
  ),
  easyQuiz(
    "Geografía",
    "¿En qué continente está Brasil?",
    ["América del Sur", "Europa", "Asia", "África"],
    "Brasil ocupa gran parte de América del Sur.",
    "https://www.britannica.com/place/Brazil",
  ),
  easyQuiz(
    "Geografía",
    "¿Qué cordillera alberga el Everest?",
    ["Himalaya", "Andes", "Alpes", "Pirineos"],
    "El Everest forma parte del Himalaya.",
    "https://www.britannica.com/place/Mount-Everest",
  ),
  easyQuiz(
    "Geografía",
    "¿Qué río atraviesa Egipto antes de llegar al Mediterráneo?",
    ["Nilo", "Danubio", "Tajo", "Sena"],
    "El Nilo atraviesa Egipto hacia el mar Mediterráneo.",
    "https://www.britannica.com/place/Nile-River",
  ),
  easyQuiz(
    "Ciencia",
    "¿Cuál es el planeta más grande del sistema solar?",
    ["Júpiter", "Marte", "Venus", "Mercurio"],
    "Júpiter es el planeta de mayor tamaño.",
    "https://science.nasa.gov/jupiter/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Cuál es la estrella más cercana a la Tierra?",
    ["El Sol", "Sirio", "Vega", "Polaris"],
    "El Sol es la estrella de nuestro sistema solar.",
    "https://science.nasa.gov/sun/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Cuál es el satélite natural de la Tierra?",
    ["La Luna", "Fobos", "Europa", "Titán"],
    "La Luna orbita la Tierra.",
    "https://science.nasa.gov/moon/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué planeta tiene anillos muy visibles?",
    ["Saturno", "Mercurio", "Marte", "Venus"],
    "Saturno posee un sistema de anillos destacado.",
    "https://science.nasa.gov/saturn/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Cuál es la fórmula química del agua?",
    ["H₂O", "CO₂", "O₂", "NaCl"],
    "El agua está formada por hidrógeno y oxígeno.",
    "https://www.usgs.gov/special-topics/water-science-school/science/water-properties",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué gas es más abundante en la atmósfera terrestre?",
    ["Nitrógeno", "Oxígeno", "Helio", "Hidrógeno"],
    "El nitrógeno es el gas principal de la atmósfera.",
    "https://science.nasa.gov/earth/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué instrumento mide la temperatura?",
    ["Termómetro", "Barómetro", "Brújula", "Regla"],
    "Un termómetro sirve para medir la temperatura.",
    "https://www.britannica.com/science/thermometer",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué instrumento indica la hora?",
    ["Reloj", "Microscopio", "Altavoz", "Prisma"],
    "Un reloj mide o indica el tiempo.",
    "https://www.britannica.com/technology/clock",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué pigmento permite a las plantas captar luz?",
    ["Clorofila", "Melanina", "Hemoglobina", "Queratina"],
    "La clorofila participa en la fotosíntesis.",
    "https://science.nasa.gov/earth/",
  ),
  easyQuiz(
    "Ciencia",
    "¿Qué unidad se usa para medir una distancia muy grande en astronomía?",
    ["Año luz", "Minuto", "Gramo", "Litro"],
    "Un año luz es una unidad de distancia.",
    "https://science.nasa.gov/exoplanets/",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos lados tiene un triángulo?",
    ["Tres", "Cuatro", "Cinco", "Seis"],
    "Un triángulo es un polígono de tres lados.",
    "https://www.britannica.com/science/triangle",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos lados tiene un hexágono?",
    ["Seis", "Cinco", "Siete", "Ocho"],
    "Un hexágono tiene seis lados.",
    "https://www.britannica.com/science/hexagon",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos centímetros tiene un metro?",
    ["Cien", "Diez", "Mil", "Milímetros"],
    "Un metro equivale a cien centímetros.",
    "https://www.britannica.com/science/metre",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos metros tiene un kilómetro?",
    ["Mil", "Cien", "Diez", "Diez mil"],
    "Un kilómetro equivale a mil metros.",
    "https://www.britannica.com/science/kilometre",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuánto es 2 más 3?",
    ["5", "4", "6", "7"],
    "La suma de 2 y 3 es 5.",
    "https://www.britannica.com/science/arithmetic",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuánto es 9 por 9?",
    ["81", "72", "90", "99"],
    "Nueve multiplicado por nueve es 81.",
    "https://www.britannica.com/science/arithmetic",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuál es la raíz cuadrada de 64?",
    ["8", "6", "7", "9"],
    "Ocho por ocho es 64.",
    "https://www.britannica.com/science/square-root",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos minutos tiene una hora?",
    ["60", "30", "90", "100"],
    "Una hora se divide convencionalmente en 60 minutos.",
    "https://www.britannica.com/science/time-measurement",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos días tiene una semana?",
    ["7", "5", "6", "8"],
    "La semana convencional tiene siete días.",
    "https://www.britannica.com/science/week",
  ),
  easyQuiz(
    "Matemáticas",
    "¿Cuántos meses tiene un año?",
    ["12", "10", "11", "13"],
    "El calendario civil tiene doce meses.",
    "https://www.britannica.com/science/calendar",
  ),
  easyQuiz(
    "Naturaleza",
    "¿Qué animal produce miel?",
    ["Abeja", "Mariposa", "Hormiga", "Libélula"],
    "Las abejas producen miel.",
    "https://www.britannica.com/animal/bee-insect",
  ),
  easyQuiz(
    "Naturaleza",
    "¿Qué animal es un anfibio?",
    ["Rana", "Águila", "Tiburón", "Gato"],
    "Las ranas son anfibios.",
    "https://www.britannica.com/animal/frog",
  ),
  easyQuiz(
    "Naturaleza",
    "¿Qué grupo animal tiene plumas?",
    ["Aves", "Peces", "Reptiles", "Anfibios"],
    "Las plumas son una característica de las aves.",
    "https://www.britannica.com/animal/bird-animal",
  ),
  easyQuiz(
    "Naturaleza",
    "¿Qué mamífero vive habitualmente en el mar?",
    ["Ballena", "Atún", "Pulpo", "Trucha"],
    "Las ballenas son mamíferos marinos.",
    "https://www.britannica.com/animal/whale",
  ),
  easyQuiz(
    "Naturaleza",
    "¿Qué árbol produce bellotas?",
    ["Roble", "Pino", "Palmera", "Abeto"],
    "Las bellotas son frutos de los robles.",
    "https://www.britannica.com/plant/oak",
  ),
  easyQuiz(
    "Naturaleza",
    "¿En qué se transforma una oruga?",
    ["Mariposa", "Pez", "Rana", "Lagarto"],
    "Muchas orugas realizan metamorfosis y se convierten en mariposas.",
    "https://www.britannica.com/animal/butterfly-insect",
  ),
  easyQuiz(
    "Lengua",
    "¿Cuál es el antónimo de frío?",
    ["Caliente", "Helado", "Fresco", "Gélido"],
    "Caliente expresa la idea opuesta a frío.",
    "https://dle.rae.es/caliente",
  ),
  easyQuiz(
    "Lengua",
    "¿Cuál es un sinónimo de rápido?",
    ["Veloz", "Lento", "Pesado", "Quieto"],
    "Veloz y rápido tienen significados próximos.",
    "https://dle.rae.es/veloz",
  ),
  easyQuiz(
    "Lengua",
    "¿Qué palabra nombra una vivienda?",
    ["Casa", "Río", "Nube", "Puente"],
    "Casa es el nombre habitual de una vivienda.",
    "https://dle.rae.es/casa",
  ),
  easyQuiz(
    "Lengua",
    "¿Qué palabra nombra un recipiente para beber?",
    ["Taza", "Mapa", "Rama", "Reloj"],
    "Una taza es un recipiente pequeño para beber.",
    "https://dle.rae.es/taza",
  ),
  easyQuiz(
    "Lengua",
    "¿Qué palabra nombra una corriente natural de agua?",
    ["Río", "Roca", "Ropa", "Rosa"],
    "Un río es una corriente natural de agua.",
    "https://dle.rae.es/río",
  ),
  easyQuiz(
    "Lengua",
    "¿Qué palabra nombra una parte de un árbol?",
    ["Rama", "Nube", "Mesa", "Seda"],
    "Una rama nace del tronco de un árbol.",
    "https://dle.rae.es/rama",
  ),
  easyQuiz(
    "Cultura",
    "¿Quién compuso la Novena Sinfonía?",
    ["Beethoven", "Velázquez", "Cervantes", "Newton"],
    "Ludwig van Beethoven compuso la Novena Sinfonía.",
    "https://www.britannica.com/biography/Ludwig-van-Beethoven",
  ),
  easyQuiz(
    "Cultura",
    "¿Qué pintor creó Guernica?",
    ["Pablo Picasso", "Salvador Dalí", "Francisco de Goya", "Joan Miró"],
    "Guernica es una obra de Pablo Picasso.",
    "https://www.britannica.com/biography/Pablo-Picasso",
  ),
  easyQuiz(
    "Cultura",
    "¿Qué escritor creó a Don Quijote?",
    ["Miguel de Cervantes", "Federico García Lorca", "Lope de Vega", "Antonio Machado"],
    "Cervantes es el autor de Don Quijote de la Mancha.",
    "https://www.cervantes.es/",
  ),
  easyQuiz(
    "Cultura",
    "¿Qué arte utiliza sonidos y silencios organizados?",
    ["Música", "Escultura", "Arquitectura", "Pintura"],
    "La música organiza sonidos y silencios.",
    "https://www.britannica.com/art/music",
  ),
  easyQuiz(
    "Cultura",
    "¿Qué obra se proyecta en una sala de cine?",
    ["Película", "Novela", "Mapa", "Escultura"],
    "El cine proyecta obras audiovisuales.",
    "https://www.britannica.com/art/motion-picture",
  ),
  easyQuiz(
    "Tecnología",
    "¿Qué dispositivo mueve el puntero en muchos ordenadores?",
    ["Ratón", "Altavoz", "Impresora", "Micrófono"],
    "El ratón permite controlar el puntero.",
    "https://www.britannica.com/technology/computer-mouse",
  ),
  easyQuiz(
    "Tecnología",
    "¿Qué aparato muestra información visual de un ordenador?",
    ["Monitor", "Teclado", "Router", "Batería"],
    "El monitor muestra la salida visual.",
    "https://www.britannica.com/technology/computer-monitor",
  ),
  easyQuiz(
    "Tecnología",
    "¿Qué dispositivo imprime documentos en papel?",
    ["Impresora", "Escáner", "Teclado", "Auricular"],
    "Una impresora produce copias en papel.",
    "https://www.britannica.com/technology/printer-computer",
  ),
  easyQuiz(
    "Tecnología",
    "¿Qué aparato captura sonido para un ordenador?",
    ["Micrófono", "Monitor", "Ratón", "Proyector"],
    "Un micrófono transforma sonido en señal.",
    "https://www.britannica.com/technology/microphone",
  ),
  easyQuiz(
    "Historia",
    "¿En qué continente surgió la civilización del antiguo Egipto?",
    ["África", "Europa", "Asia", "Oceanía"],
    "El antiguo Egipto se desarrolló en el noreste de África.",
    "https://www.britannica.com/place/ancient-Egypt",
  ),
  easyQuiz(
    "Historia",
    "¿Qué ciudad fue la capital del Imperio romano?",
    ["Roma", "Atenas", "Cartago", "Toledo"],
    "Roma fue el centro político del Imperio romano.",
    "https://www.britannica.com/place/Rome",
  ),
  easyQuiz(
    "Vida cotidiana",
    "¿Qué estación sucede al verano en España?",
    ["Otoño", "Primavera", "Invierno", "Verano"],
    "En el hemisferio norte el otoño sucede al verano.",
    "https://www.britannica.com/science/season",
  ),
  easyQuiz(
    "Vida cotidiana",
    "¿Qué mes inicia el año civil?",
    ["Enero", "Marzo", "Junio", "Diciembre"],
    "Enero es el primer mes del año civil.",
    "https://www.britannica.com/science/calendar",
  ),
  easyQuiz(
    "España",
    "¿Qué idioma es oficial en toda España?",
    ["Español", "Euskera", "Catalán", "Gallego"],
    "El castellano es la lengua española oficial del Estado.",
    "https://www.lamoncloa.gob.es/espana/",
  ),
  easyQuiz(
    "España",
    "¿Qué mar baña la costa este de España?",
    ["Mediterráneo", "Báltico", "Negro", "Rojo"],
    "El mar Mediterráneo baña gran parte de la costa oriental española.",
    "https://www.britannica.com/place/Spain",
  ),
  easyQuiz(
    "Deportes",
    "¿Cuántos jugadores tiene un equipo de fútbol en el campo?",
    ["11", "9", "10", "12"],
    "Cada equipo comienza un partido con once jugadores.",
    "https://www.fifa.com/",
  ),
  easyQuiz(
    "Deportes",
    "¿Con qué objeto se juega al tenis?",
    ["Raqueta", "Bate", "Palo", "Guante"],
    "En tenis se golpea la pelota con una raqueta.",
    "https://www.britannica.com/sports/tennis",
  ),
  easyQuiz(
    "Gastronomía",
    "¿Qué producto se obtiene principalmente de la leche?",
    ["Queso", "Pan", "Arroz", "Aceite"],
    "El queso se elabora a partir de leche.",
    "https://www.britannica.com/topic/cheese-food",
  ),
  easyQuiz(
    "Gastronomía",
    "¿Qué fruto se usa para producir aceite de oliva?",
    ["Aceituna", "Uva", "Naranja", "Fresa"],
    "El aceite de oliva procede de las aceitunas.",
    "https://www.britannica.com/topic/olive",
  ),
] as const;

const levelQuizFacts = [
  quizFact("very_easy", "¿Cuánto es 2 más 2?", ["4", "3", "5", "6"], "Dos más dos es cuatro."),
  quizFact(
    "very_easy",
    "¿Qué figura tiene tres lados?",
    ["Triángulo", "Cuadrado", "Círculo", "Rectángulo"],
    "Un triángulo tiene tres lados.",
  ),
  quizFact(
    "very_easy",
    "¿Qué animal suele maullar?",
    ["Gato", "Perro", "Caballo", "Pez"],
    "El maullido es propio del gato.",
  ),
  quizFact(
    "very_easy",
    "¿Qué astro ilumina la Tierra durante el día?",
    ["El Sol", "La Luna", "Marte", "Venus"],
    "El Sol es la estrella de nuestro sistema.",
  ),
  quizFact(
    "very_easy",
    "¿Qué día sigue al lunes?",
    ["Martes", "Domingo", "Jueves", "Sábado"],
    "Martes sigue a lunes.",
  ),
  quizFact(
    "medium",
    "¿En qué capa de la atmósfera ocurre la mayor parte del tiempo meteorológico?",
    ["Troposfera", "Exosfera", "Termosfera", "Mesosfera"],
    "La troposfera es la capa atmosférica más baja.",
  ),
  quizFact(
    "medium",
    "¿Qué civilización construyó Machu Picchu?",
    ["Inca", "Romana", "Egipcia", "Maya"],
    "Machu Picchu fue construido por los incas.",
  ),
  quizFact(
    "medium",
    "¿Qué novela escribió Mary Shelley?",
    ["Frankenstein", "Drácula", "Jane Eyre", "La isla del tesoro"],
    "Mary Shelley escribió Frankenstein.",
  ),
  quizFact(
    "hard",
    "¿Qué unidad del SI mide la intensidad luminosa?",
    ["Candela", "Lumen", "Lux", "Vatio"],
    "La candela es la unidad base del SI para la intensidad luminosa.",
  ),
  quizFact(
    "hard",
    "¿Cómo se llama el estudio científico de los hongos?",
    ["Micología", "Ornitología", "Geología", "Citología"],
    "La micología estudia los hongos.",
  ),
  quizFact(
    "hard",
    "¿Qué proceso libera vapor de agua desde las plantas?",
    ["Transpiración", "Fermentación", "Germinación", "Polinización"],
    "La transpiración libera agua en forma de vapor.",
  ),
  quizFact(
    "hard",
    "¿Qué mineral ocupa el valor 10 de la escala de Mohs?",
    ["Diamante", "Cuarzo", "Talco", "Yeso"],
    "El diamante ocupa el extremo superior de la escala de Mohs.",
  ),
  quizFact(
    "hard",
    "¿Cómo se llaman los dos satélites de Marte?",
    ["Fobos y Deimos", "Ío y Europa", "Titán y Rea", "Ariel y Umbriel"],
    "Fobos y Deimos son los satélites naturales de Marte.",
  ),
  quizFact(
    "expert",
    "¿Qué unidad del SI expresa la actividad catalítica?",
    ["Katal", "Siemens", "Weber", "Becquerel"],
    "El katal es la unidad derivada para la actividad catalítica.",
  ),
  quizFact(
    "expert",
    "¿Qué elemento tiene el símbolo W?",
    ["Wolframio", "Rutenio", "Renio", "Hafnio"],
    "W es el símbolo del wolframio.",
  ),
  quizFact(
    "expert",
    "¿Qué tipo de enlace une las dos hebras de ADN?",
    ["Puentes de hidrógeno", "Enlaces iónicos", "Enlaces metálicos", "Enlaces peptídicos"],
    "Las bases complementarias se unen con puentes de hidrógeno.",
  ),
  quizFact(
    "expert",
    "¿Qué disciplina estudia el significado de las expresiones lingüísticas?",
    ["Semántica", "Fonética", "Morfología", "Ortografía"],
    "La semántica estudia el significado lingüístico.",
  ),
  quizFact(
    "expert",
    "¿Qué partícula media la interacción electromagnética?",
    ["Fotón", "Gluón", "Neutrino", "Bosón de Higgs"],
    "El fotón es el cuanto del campo electromagnético.",
  ),
] as const;

const quizFacts = [...baseQuizFacts, ...additionalQuizFacts, ...levelQuizFacts] as const;

const trueFalseFacts = [
  trueFalse(
    "La Tierra gira alrededor del Sol.",
    true,
    "La Tierra completa una órbita solar cada año.",
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
    "El agua es un elemento químico.",
    false,
    "El agua es un compuesto formado por hidrógeno y oxígeno.",
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
    1,
    "https://www.nist.gov/pml/speed-light",
  ),
  trueFalse(
    "Cervantes escribió La Odisea.",
    false,
    "La Odisea se atribuye a Homero; Cervantes escribió Don Quijote.",
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
  trueFalse(
    "El símbolo químico del oro es Au.",
    true,
    "Au procede del nombre latino aurum.",
    "Ciencia",
    1,
    "https://www.rsc.org/periodic-table/element/79/gold",
  ),
  trueFalse(
    "Durante la fotosíntesis las plantas absorben principalmente oxígeno.",
    false,
    "Las plantas usan dióxido de carbono durante la fotosíntesis.",
    "Naturaleza",
    1,
    "https://science.nasa.gov/earth/",
  ),
  trueFalse(
    "Venus es el planeta más caliente del sistema solar.",
    true,
    "Su densa atmósfera retiene mucho calor.",
    "Ciencia",
    1,
    "https://science.nasa.gov/venus/",
  ),
  trueFalse(
    "Mercurio es el planeta más grande del sistema solar.",
    false,
    "Júpiter es el planeta de mayor tamaño.",
    "Ciencia",
    1,
    "https://science.nasa.gov/jupiter/",
  ),
  trueFalse(
    "Los pulpos tienen tres corazones.",
    true,
    "Los pulpos poseen dos corazones branquiales y uno sistémico.",
    "Naturaleza",
    1,
    "https://ocean.si.edu/ocean-life/invertebrates/octopuses-and-squids",
  ),
  trueFalse(
    "La Antártida es un continente.",
    true,
    "La Antártida es el continente situado alrededor del polo sur.",
    "Geografía",
    1,
    "https://www.britannica.com/place/Antarctica",
  ),
  trueFalse(
    "El desierto del Sahara es una selva tropical.",
    false,
    "El Sahara es un gran desierto del norte de África.",
    "Geografía",
    1,
    "https://www.britannica.com/place/Sahara-desert-Africa",
  ),
  trueFalse(
    "El Everest está en África.",
    false,
    "El Everest se encuentra en la cordillera del Himalaya.",
    "Geografía",
    1,
    "https://www.britannica.com/place/Mount-Everest",
  ),
  trueFalse(
    "El sonido suele viajar más rápido en agua que en aire.",
    true,
    "La velocidad del sonido depende del medio por el que se propaga.",
    "Ciencia",
    1,
    "https://www.nist.gov/pml",
  ),
  trueFalse(
    "H₂O es la fórmula del dióxido de carbono.",
    false,
    "H₂O representa agua; el dióxido de carbono es CO₂.",
    "Ciencia",
    1,
    "https://www.usgs.gov/special-topics/water-science-school/science/water-properties",
  ),
  trueFalse(
    "Un cuadrado tiene tres lados.",
    false,
    "Un cuadrado tiene cuatro lados iguales.",
    "Matemáticas",
    1,
    "https://www.britannica.com/science/square-geometry",
  ),
  trueFalse(
    "Los pingüinos son aves.",
    true,
    "Los pingüinos son aves adaptadas a la vida acuática.",
    "Naturaleza",
    1,
    "https://www.britannica.com/animal/penguin",
  ),
  trueFalse(
    "Todas las ballenas son peces.",
    false,
    "Las ballenas son mamíferos marinos.",
    "Naturaleza",
    1,
    "https://www.britannica.com/animal/whale",
  ),
  trueFalse(
    "La atmósfera terrestre está compuesta principalmente por oxígeno.",
    false,
    "El nitrógeno es el gas más abundante en la atmósfera.",
    "Ciencia",
    1,
    "https://science.nasa.gov/earth/",
  ),
  trueFalse(
    "Un año tiene doce meses.",
    true,
    "El calendario civil divide el año en doce meses.",
    "Vida cotidiana",
    1,
    "https://www.britannica.com/science/calendar",
  ),
  trueFalse(
    "Una hora tiene sesenta minutos.",
    true,
    "La división convencional de una hora es de sesenta minutos.",
    "Vida cotidiana",
    1,
    "https://www.britannica.com/science/time-measurement",
  ),
  trueFalse(
    "Una semana tiene ocho días.",
    false,
    "La semana convencional tiene siete días.",
    "Vida cotidiana",
    1,
    "https://www.britannica.com/science/week",
  ),
  trueFalse(
    "Los anillos de Saturno contienen principalmente partículas de hielo.",
    true,
    "Los anillos están compuestos en gran parte por hielo y polvo.",
    "Ciencia",
    1,
    "https://science.nasa.gov/saturn/",
  ),
  trueFalse(
    "Júpiter es más pequeño que Marte.",
    false,
    "Júpiter es mucho mayor que Marte.",
    "Ciencia",
    1,
    "https://science.nasa.gov/jupiter/",
  ),
  trueFalse(
    "El ADN es una molécula.",
    true,
    "El ADN almacena información genética en los seres vivos.",
    "Ciencia",
    1,
    "https://www.genome.gov/genetics-glossary/DNA",
  ),
  trueFalse(
    "Madrid es la capital de España.",
    true,
    "Madrid es la capital del Estado español.",
    "Geografía",
    1,
    "https://www.lamoncloa.gob.es/espana/",
  ),
  trueFalse(
    "Lisboa es la capital de Francia.",
    false,
    "Lisboa es la capital de Portugal; París es la de Francia.",
    "Geografía",
    1,
    "https://www.britannica.com/place/Lisbon",
  ),
  trueFalse(
    "El Nilo es un río.",
    true,
    "El Nilo es un gran río del noreste de África.",
    "Geografía",
    1,
    "https://www.britannica.com/place/Nile-River",
  ),
  trueFalse(
    "Un hexágono tiene seis lados.",
    true,
    "Un hexágono es un polígono de seis lados.",
    "Matemáticas",
    1,
    "https://www.britannica.com/science/hexagon",
  ),
  trueFalse(
    "Un piano produce sonido mediante cuerdas.",
    true,
    "En un piano los martillos golpean cuerdas tensas.",
    "Música",
    1,
    "https://www.britannica.com/art/piano-musical-instrument",
  ),
  trueFalse(
    "Un violín es un instrumento de metal.",
    false,
    "El violín es un instrumento de cuerda frotada.",
    "Música",
    1,
    "https://www.britannica.com/art/violin",
  ),
  trueFalse(
    "El agua se congela a 0 °C a presión atmosférica normal.",
    true,
    "El punto de congelación del agua se toma como referencia de la escala Celsius.",
    "Ciencia",
    1,
    "https://www.nist.gov/pml",
  ),
  trueFalse(
    "El océano Pacífico está enteramente en el hemisferio norte.",
    false,
    "El Pacífico se extiende por ambos hemisferios.",
    "Geografía",
    1,
    "https://oceanservice.noaa.gov/facts/largest-ocean.html",
  ),
  trueFalse(
    "La clorofila participa en la fotosíntesis.",
    true,
    "La clorofila absorbe luz para impulsar la fotosíntesis.",
    "Naturaleza",
    1,
    "https://science.nasa.gov/earth/",
  ),
  trueFalse(
    "Una brújula apunta siempre al norte geográfico exacto.",
    false,
    "Una brújula responde al campo magnético terrestre.",
    "Geografía",
    1,
    "https://www.nationalgeographic.org/encyclopedia/compass/",
  ),
  trueFalse(
    "Un año luz mide tiempo.",
    false,
    "Un año luz es una unidad de distancia.",
    "Ciencia",
    1,
    "https://science.nasa.gov/exoplanets/",
  ),
  trueFalse(
    "El sistema solar tiene ocho planetas.",
    true,
    "La Unión Astronómica Internacional reconoce ocho planetas.",
    "Ciencia",
    1,
    "https://science.nasa.gov/solar-system/",
  ),
] as const;

const additionalTrueFalseFacts = [
  trueFalse(
    "Lisboa es la capital de Portugal.",
    true,
    "Lisboa es la capital portuguesa.",
    "Geografía",
    2,
    "https://www.britannica.com/place/Lisbon",
  ),
  trueFalse(
    "Un triángulo tiene cuatro lados.",
    false,
    "Un triángulo tiene tres lados.",
    "Matemáticas",
    2,
    "https://www.britannica.com/science/triangle",
  ),
  trueFalse(
    "Un día completo tiene veinticuatro horas.",
    true,
    "Por convención, un día civil se divide en veinticuatro horas.",
    "Vida cotidiana",
    2,
    "https://www.britannica.com/science/day",
  ),
  trueFalse(
    "La fotosíntesis libera oxígeno.",
    true,
    "La fotosíntesis produce oxígeno como subproducto.",
    "Ciencia",
    3,
    "https://www.britannica.com/science/photosynthesis",
  ),
  trueFalse(
    "El ADN utiliza uracilo como una de sus bases.",
    false,
    "El uracilo forma parte del ARN; el ADN utiliza timina.",
    "Ciencia",
    3,
    "https://www.britannica.com/science/DNA",
  ),
  trueFalse(
    "La península ibérica incluye territorio de España y Portugal.",
    true,
    "España y Portugal ocupan la mayor parte de la península ibérica.",
    "Geografía",
    3,
    "https://www.britannica.com/place/Iberian-Peninsula",
  ),
  trueFalse(
    "Un pársec equivale aproximadamente a 3,26 años luz.",
    true,
    "Un pársec corresponde aproximadamente a 3,26 años luz.",
    "Astronomía",
    4,
    "https://science.nasa.gov/exoplanets/",
  ),
  trueFalse(
    "El número de Avogadro es aproximadamente 6,022 × 10²³.",
    true,
    "El número de Avogadro expresa cuántas entidades hay en un mol.",
    "Química",
    4,
    "https://www.britannica.com/science/Avogadros-number",
  ),
  trueFalse(
    "El meridiano de Greenwich pasa por Madrid.",
    false,
    "El meridiano cero pasa por Greenwich, en el Reino Unido.",
    "Geografía",
    4,
    "https://www.britannica.com/place/Greenwich",
  ),
  trueFalse(
    "El bosón W interviene en la interacción nuclear débil.",
    true,
    "Los bosones W transmiten la interacción nuclear débil.",
    "Física",
    5,
    "https://home.cern/science/physics/standard-model",
  ),
  trueFalse(
    "El ATP contiene ribosa.",
    true,
    "El ATP incluye una molécula de ribosa, adenina y grupos fosfato.",
    "Bioquímica",
    5,
    "https://www.britannica.com/science/adenosine-triphosphate",
  ),
  trueFalse(
    "Los gluones transmiten la interacción electromagnética.",
    false,
    "Los gluones transmiten la interacción fuerte; el fotón media la electromagnética.",
    "Física",
    5,
    "https://home.cern/science/physics/standard-model",
  ),
] as const;

const allTrueFalseFacts = [...trueFalseFacts, ...additionalTrueFalseFacts] as const;

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

const advancedGuessWords = [
  guessWord(
    "ECUACION",
    "Matemáticas",
    "Igualdad entre dos expresiones que puede contener incógnitas.",
    4,
    ["Se resuelve para hallar un valor desconocido.", 2],
    "https://dle.rae.es/ecuación",
  ),
  guessWord(
    "ECOSISTEMA",
    "Naturaleza",
    "Conjunto formado por seres vivos y el medio con el que se relacionan.",
    4,
    ["Incluye organismos y su entorno.", 2],
    "https://www.britannica.com/science/ecosystem",
  ),
  guessWord(
    "PENINSULA",
    "Geografía",
    "Tierra rodeada de agua salvo por una zona que la une a otra extensión terrestre.",
    4,
    ["La ibérica es un ejemplo europeo.", 2],
    "https://dle.rae.es/península",
  ),
  guessWord(
    "FOTOSINTESIS",
    "Ciencia",
    "Proceso por el que plantas y otros organismos transforman energía luminosa en energía química.",
    5,
    ["Las plantas la realizan principalmente en las hojas.", 3],
    "https://www.britannica.com/science/photosynthesis",
  ),
  guessWord(
    "METEORITO",
    "Astronomía",
    "Fragmento de un cuerpo celeste que alcanza la superficie de un planeta o satélite.",
    5,
    ["Procede del espacio y puede llegar al suelo.", 3],
    "https://science.nasa.gov/solar-system/meteors-meteorites/",
  ),
  guessWord(
    "CONSTITUCION",
    "Derecho",
    "Norma fundamental que organiza un Estado y reconoce derechos básicos.",
    5,
    ["En España fue aprobada en 1978.", 3],
    "https://www.britannica.com/topic/constitution-politics",
  ),
] as const;

const allGuessWords = [...guessWords, ...advancedGuessWords] as const;

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

const wordSearchDifficultyConfig = {
  1: { columns: 6, directions: ["east", "south"], rows: 6, wordCount: 3 },
  2: { columns: 8, directions: ["east", "south", "southEast"], rows: 8, wordCount: 5 },
  3: {
    columns: 10,
    directions: ["east", "south", "southEast", "northEast", "west"],
    rows: 10,
    wordCount: 6,
  },
  4: {
    columns: 12,
    directions: ["east", "south", "southEast", "northEast", "west", "north", "northWest"],
    rows: 12,
    wordCount: 7,
  },
  5: {
    columns: 14,
    directions: [
      "east",
      "south",
      "southEast",
      "northEast",
      "west",
      "north",
      "northWest",
      "southWest",
    ],
    rows: 14,
    wordCount: 8,
  },
} as const;

const crosswordBanks: readonly (readonly WordBankEntry[])[] = [
  [
    word("sol", "SOL", "Estrella del sistema solar"),
    word("sal", "SAL", "Condimento mineral"),
    word("luz", "LUZ", "Claridad que permite ver"),
  ],
  [
    word("mar", "MAR", "Masa de agua salada"),
    word("rama", "RAMA", "Parte de un árbol que nace del tronco"),
    word("rio", "RIO", "Corriente natural de agua"),
  ],
  [
    word("pan", "PAN", "Alimento hecho con harina"),
    word("pato", "PATO", "Ave acuática de pico ancho"),
    word("nube", "NUBE", "Masa visible de agua en el cielo"),
  ],
  [
    word("gato", "GATO", "Mamífero doméstico que maúlla"),
    word("taza", "TAZA", "Recipiente pequeño para beber"),
    word("tela", "TELA", "Tejido formado por hilos"),
  ],
  [
    word("casa", "CASA", "Edificio destinado a vivienda"),
    word("cama", "CAMA", "Mueble para dormir"),
    word("mapa", "MAPA", "Representación de un territorio"),
  ],
  [
    word("mesa", "MESA", "Mueble de superficie horizontal"),
    word("seda", "SEDA", "Fibra fina producida por un gusano"),
    word("dado", "DADO", "Cubo usado en juegos de azar"),
  ],
  [
    word("perro", "PERRO", "Mamífero doméstico que ladra"),
    word("rosa", "ROSA", "Flor de tallo espinoso"),
    word("roca", "ROCA", "Piedra grande y dura"),
  ],
  [
    word("luna", "LUNA", "Satélite natural de la Tierra"),
    word("nata", "NATA", "Capa grasa que forma la leche"),
    word("nido", "NIDO", "Refugio que construyen las aves"),
  ],
  [
    word("flor", "FLOR", "Parte reproductora de una planta"),
    word("fuego", "FUEGO", "Combustión que produce calor y luz"),
    word("gota", "GOTA", "Porción pequeña de un líquido"),
  ],
  [
    word("tren", "TREN", "Conjunto de vagones sobre raíles"),
    word("rana", "RANA", "Anfibio que salta"),
    word("reloj", "RELOJ", "Instrumento que indica la hora"),
  ],
  [
    word("vela", "VELA", "Cilindro de cera con mecha"),
    word("lago", "LAGO", "Masa de agua rodeada de tierra"),
    word("goma", "GOMA", "Material flexible y elástico"),
  ],
  [
    word("vaca", "VACA", "Hembra adulta del ganado bovino"),
    word("cielo", "CIELO", "Espacio visible sobre la Tierra"),
    word("cubo", "CUBO", "Sólido de seis caras cuadradas"),
  ],
  [
    word("pez", "PEZ", "Animal vertebrado que vive en agua"),
    word("zorro", "ZORRO", "Mamífero de hocico puntiagudo"),
    word("ropa", "ROPA", "Conjunto de prendas de vestir"),
  ],
  [
    word("cafe", "CAFE", "Bebida obtenida de granos tostados"),
    word("fresa", "FRESA", "Fruto rojo de una planta herbácea"),
    word("arena", "ARENA", "Conjunto de granos de roca"),
  ],
];

function word(id: string, answer: string, clue: string): WordBankEntry {
  return { answer, clue, id, sourceUrl: "https://dle.rae.es/" };
}

function fact(
  category: string,
  difficulty: "very_easy" | "easy" | "medium" | "hard" | "expert",
  prompt: string,
  options: readonly [string, string, string, string],
  correctIndex: number,
  explanation: string,
  sourceUrl: string,
) {
  return { category, difficulty, prompt, options, correctIndex, explanation, sourceUrl };
}

function easyQuiz(
  category: string,
  prompt: string,
  options: readonly [string, string, string, string],
  explanation: string,
  sourceUrl: string,
) {
  return fact(category, "easy", prompt, options, 0, explanation, sourceUrl);
}

function quizFact(
  difficulty: "very_easy" | "medium" | "hard" | "expert",
  prompt: string,
  options: readonly [string, string, string, string],
  explanation: string,
) {
  return fact(
    "Cultura general",
    difficulty,
    prompt,
    options,
    0,
    explanation,
    "https://www.britannica.com/",
  );
}

function quizDifficultyLevel(
  difficulty: "very_easy" | "easy" | "medium" | "hard" | "expert",
): 1 | 2 | 3 | 4 | 5 {
  return ({ very_easy: 1, easy: 2, medium: 3, hard: 4, expert: 5 } as const)[difficulty];
}

function trueFalse(
  statement: string,
  value: boolean,
  explanation: string,
  category: string,
  difficulty: 1 | 2 | 3 | 4 | 5,
  sourceUrl: string,
) {
  return { statement, value, explanation, category, difficulty, sourceUrl };
}

function guessWord(
  answer: string,
  category: string,
  definition: string,
  difficulty: 1 | 2 | 3 | 4 | 5,
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
  if (items.length === 0) throw new Error("No curated content exists for this target difficulty");
  const start = Math.abs(Date.parse(`${targetDate}T12:00:00Z`) / 86_400_000) % items.length;
  return Array.from(
    { length: count },
    (_, index) => items[(Math.floor(start) + index) % items.length]!,
  );
}

function cyclicDaily<T>(items: readonly T[], targetDate: string, count: number): readonly T[] {
  if (items.length === 0) throw new Error("No curated content exists for this target difficulty");
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
