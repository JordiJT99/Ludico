import { isCrosswordLocalDraft, type CrosswordLocalDraft } from "@ludico/contracts";

const prefix = "ludico.crossword-draft.v1.";

export async function readCrosswordDraft(gameId: string): Promise<CrosswordLocalDraft | null> {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isCrosswordLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export async function writeCrosswordDraft(draft: CrosswordLocalDraft): Promise<void> {
  localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
}

export async function removeCrosswordDraft(gameId: string): Promise<void> {
  localStorage.removeItem(prefix + gameId);
}
