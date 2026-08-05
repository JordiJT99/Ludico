import { isGuessWordLocalDraft, type GuessWordLocalDraft } from "@ludico/contracts";

const prefix = "ludico.guess-word-draft.v1.";

export function readGuessWordDraft(gameId: string): GuessWordLocalDraft | null {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isGuessWordLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export function writeGuessWordDraft(draft: GuessWordLocalDraft): void {
  try {
    localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
  } catch {
    // La partida remota sigue siendo la fuente de verdad si el almacenamiento falla.
  }
}

export function removeGuessWordDraft(gameId: string): void {
  try {
    localStorage.removeItem(prefix + gameId);
  } catch {
    // No impide mostrar un resultado ya aceptado.
  }
}
