import { isWordSearchLocalDraft, type WordSearchLocalDraft } from "@ludico/contracts";

const prefix = "ludico.word-search-draft.v1.";

export function readWordSearchDraft(gameId: string): WordSearchLocalDraft | null {
  try {
    const value = localStorage.getItem(prefix + gameId);
    if (!value) return null;
    const draft: unknown = JSON.parse(value);
    return isWordSearchLocalDraft(draft, gameId) ? draft : null;
  } catch {
    return null;
  }
}

export function writeWordSearchDraft(draft: WordSearchLocalDraft): void {
  try {
    localStorage.setItem(prefix + draft.gameId, JSON.stringify(draft));
  } catch {
    // La partida remota sigue siendo la fuente de verdad si el almacenamiento falla.
  }
}

export function removeWordSearchDraft(gameId: string): void {
  try {
    localStorage.removeItem(prefix + gameId);
  } catch {
    // No impide mostrar un resultado ya aceptado.
  }
}
