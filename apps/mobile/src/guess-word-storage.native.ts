import { isGuessWordLocalDraft, type GuessWordLocalDraft } from "@ludico/contracts";
import Storage from "expo-sqlite/kv-store";

const prefix = "ludico.guess-word-draft.v1.";

export async function readGuessWordDraft(gameId: string): Promise<GuessWordLocalDraft | null> {
  try {
    const value = await Storage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isGuessWordLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeGuessWordDraft(draft: GuessWordLocalDraft): Promise<void> {
  await Storage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeGuessWordDraft(gameId: string): Promise<void> {
  await Storage.removeItem(prefix + gameId);
}
