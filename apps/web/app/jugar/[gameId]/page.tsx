import type { PublicGame } from "@ludico/contracts";
import { CrosswordPlayer } from "./crossword-player";
import { GuessWordPlayer } from "./guess-word-player";
import { QuizPlayer } from "./quiz-player";

export default async function PlayPage({
  params,
}: Readonly<{ params: Promise<{ gameId: string }> }>) {
  const { gameId } = await params;
  const gameType = await loadGameType(gameId);
  return gameType === "crossword" ? (
    <CrosswordPlayer gameId={gameId} />
  ) : gameType === "guess_word" ? (
    <GuessWordPlayer gameId={gameId} />
  ) : (
    <QuizPlayer
      gameId={gameId}
      gameType={gameType === "true_false" ? "true_false" : "quiz"}
      title={gameType === "true_false" ? "Verdadero o falso" : undefined}
    />
  );
}

async function loadGameType(gameId: string): Promise<PublicGame["type"] | null> {
  try {
    const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
    const response = await fetch(`${apiUrl}/games/${gameId}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as PublicGame).type : null;
  } catch {
    return null;
  }
}
