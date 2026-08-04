export function createShareText(
  gameType: "crossword" | "quiz" | "true_false",
  points: number,
  competitive: boolean,
): string {
  const game =
    gameType === "quiz"
      ? "Quiz diario"
      : gameType === "true_false"
        ? "Verdadero o falso"
        : "Crucigrama diario";
  const mode = competitive ? "Clasificación" : "Partida casual";
  return `Lúdico · ${game}\n${points} puntos · ${mode}`;
}
