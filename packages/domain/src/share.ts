export function createShareText(
  gameType: "crossword" | "quiz",
  points: number,
  competitive: boolean,
): string {
  const game = gameType === "quiz" ? "Quiz diario" : "Crucigrama diario";
  const mode = competitive ? "Clasificación" : "Partida casual";
  return `Lúdico · ${game}\n${points} puntos · ${mode}`;
}
