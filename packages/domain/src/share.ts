export function createShareText(
  gameType: "crossword" | "quiz" | "true_false" | "guess_word" | "word_search",
  points: number,
  competitive: boolean,
): string {
  const game =
    gameType === "quiz"
      ? "Quiz diario"
      : gameType === "true_false"
        ? "Verdadero o falso"
        : gameType === "guess_word"
          ? "Adivina la palabra"
          : gameType === "word_search"
            ? "Sopa de letras"
            : "Crucigrama diario";
  const mode = competitive ? "Clasificación" : "Partida casual";
  return `Lúdico · ${game}\n${points} puntos · ${mode}`;
}
