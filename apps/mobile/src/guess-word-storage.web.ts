import { isGuessWordLocalDraft, type GuessWordLocalDraft } from "@ludico/contracts";

const prefix = "ludico.guess-word-draft.v1.";

export async function readGuessWordDraft(gameId: string): Promise<GuessWordLocalDraft | null> {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isGuessWordLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeGuessWordDraft(draft: GuessWordLocalDraft): Promise<void> {
  localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeGuessWordDraft(gameId: string): Promise<void> {
  localStorage.removeItem(prefix + gameId);
}
