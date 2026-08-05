import { isWordSearchLocalDraft, type WordSearchLocalDraft } from "@ludico/contracts";
import Storage from "expo-sqlite/kv-store";

const prefix = "ludico.word-search-draft.v1.";

export async function readWordSearchDraft(gameId: string): Promise<WordSearchLocalDraft | null> {
  try {
    const value = await Storage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isWordSearchLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeWordSearchDraft(draft: WordSearchLocalDraft): Promise<void> {
  await Storage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeWordSearchDraft(gameId: string): Promise<void> {
  await Storage.removeItem(prefix + gameId);
}
