"use client";

import {
  isCrosswordAttemptState,
  isCrosswordHintResult,
  isCrosswordProgressConflict,
  isCrosswordProgressSaved,
  isCrosswordSubmitResult,
  isPublicCrosswordGame,
  type CrosswordAttemptState,
  type CrosswordEntryPublic,
  type CrosswordLocalDraft,
  type CrosswordProgressEvent,
  type CrosswordPublicPayload,
  type CrosswordSubmitResult,
} from "@ludico/contracts";
import { normalizeCrosswordLetter } from "@ludico/domain/crossword";
import {
  applyCrosswordEvents,
  synchronizeCrosswordProgress,
} from "@ludico/domain/crossword-progress";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { LeaderboardPanel } from "../../leaderboard-panel";
import { ShareButton } from "../../share-button";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";
import { readCrosswordDraft, removeCrosswordDraft, writeCrosswordDraft } from "./crossword-storage";

type PlayingState = {
  activeCellId: string;
  activeEntryId: string;
  attempt: CrosswordAttemptState;
  contentVersion: number;
  crossword: CrosswordPublicPayload;
};

type SessionState = {
  pendingEvents: readonly CrosswordProgressEvent[];
  playing: PlayingState;
  syncStatus: "saved" | "syncing" | "pending";
};

export function CrosswordPlayer({ gameId }: Readonly<{ gameId: string }>) {
  const [session, setSession] = useState<SessionState>();
  const [result, setResult] = useState<CrosswordSubmitResult>();
  const [fatalError, setFatalError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const changedAt = useRef(0);
  const startedAt = useRef(0);
  const sessionRef = useRef<SessionState | undefined>(undefined);
  const syncingRef = useRef(false);

  const updateSession = useCallback((state: SessionState) => {
    sessionRef.current = state;
    setSession(state);
  }, []);

  const sync = useCallback(async () => {
    const snapshot = sessionRef.current;
    if (!snapshot?.pendingEvents.length || syncingRef.current) return;
    syncingRef.current = true;
    const sentEventIds = new Set(snapshot.pendingEvents.map((event) => event.clientEventId));
    updateSession({ ...snapshot, syncStatus: "syncing" });
    let synchronized = false;
    try {
      const saved = await sendPending(snapshot);
      const latest = sessionRef.current ?? snapshot;
      const pendingEvents = latest.pendingEvents.filter(
        (event) => !sentEventIds.has(event.clientEventId),
      );
      updateSession({
        pendingEvents,
        playing: {
          ...latest.playing,
          attempt: applyCrosswordEvents(saved.playing.attempt, pendingEvents),
        },
        syncStatus: pendingEvents.length ? "syncing" : "saved",
      });
      setNotice(undefined);
      synchronized = true;
    } catch {
      const latest = sessionRef.current ?? snapshot;
      updateSession({ ...latest, syncStatus: "pending" });
      setNotice("Sin conexión. Las letras quedan pendientes en este dispositivo.");
    } finally {
      syncingRef.current = false;
      if (synchronized && sessionRef.current?.pendingEvents.length) void sync();
    }
  }, [updateSession]);

  useEffect(() => {
    const controller = new AbortController();
    void start(gameId, controller.signal)
      .then(async (state) => {
        startedAt.current = Date.now();
        changedAt.current = performance.now();
        if (state.playing.attempt.result) {
          removeCrosswordDraft(gameId);
          setResult(state.playing.attempt.result);
          return;
        }
        void trackAnalytics("GameStarted", {
          attemptId: state.playing.attempt.attemptId,
          entryPoint: state.playing.attempt.cells.length ? "resume" : "daily",
          gameId,
          gameType: "crossword",
          offline: !navigator.onLine,
          platform: "web",
        });
        if (state.pendingEvents.length) {
          try {
            state = await sendPending(state);
          } catch {
            state = { ...state, syncStatus: "pending" };
          }
        }
        updateSession(state);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFatalError(messageFor(cause));
      });
    return () => controller.abort();
  }, [gameId, updateSession]);

  useEffect(() => {
    if (session) writeCrosswordDraft(toDraft(gameId, session));
  }, [gameId, session]);

  useEffect(() => {
    const synchronize = () => void sync();
    window.addEventListener("online", synchronize);
    return () => window.removeEventListener("online", synchronize);
  }, [sync]);

  if (fatalError) {
    return (
      <main>
        <p className="eyebrow">Crucigrama diario</p>
        <h1>No hemos podido abrir el crucigrama</h1>
        <p role="alert">{fatalError}</p>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  if (result) {
    return (
      <main>
        <p className="eyebrow">Resultado provisional</p>
        <h1>{result.provisional.score} puntos</h1>
        <p>
          {result.provisional.completed ? "Crucigrama completado." : "Crucigrama enviado."}{" "}
          {result.competitive ? "Tu puntuación entra en la clasificación." : "Partida casual."}
        </p>
        <p>La solución y las diferencias estarán disponibles al cerrar la edición.</p>
        <LeaderboardPanel gameId={gameId} />
        <ShareButton attemptId={result.attemptId} />
        <Link className="button-link" href={`/resultados/${gameId}?attemptId=${result.attemptId}`}>
          Ver revisión al cierre
        </Link>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  if (!session) {
    return (
      <main aria-busy="true">
        <p className="eyebrow">Crucigrama diario</p>
        <h1>Preparando la cuadrícula…</h1>
      </main>
    );
  }

  const { playing } = session;
  const activeEntry = entryById(playing.crossword, playing.activeEntryId);
  const values = new Map(playing.attempt.cells.map((cell) => [cell.cellId, cell.value]));
  const filled = playing.crossword.cells.filter((cell) => values.has(cell.id)).length;

  function selectCell(cellId: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    const entries = entriesForCell(current.playing.crossword, cellId);
    const currentIndex = entries.findIndex((entry) => entry.id === current.playing.activeEntryId);
    const entry =
      entries[currentIndex >= 0 && entries.length > 1 ? (currentIndex + 1) % entries.length : 0];
    if (!entry) return;
    changedAt.current = performance.now();
    updateSession({
      ...current,
      playing: { ...current.playing, activeCellId: cellId, activeEntryId: entry.id },
    });
  }

  function selectEntryCell(entryId: string, cellId: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    updateSession({
      ...current,
      playing: { ...current.playing, activeCellId: cellId, activeEntryId: entryId },
    });
  }

  async function writeCell(cellId: string, rawValue: string, nextCellId = cellId) {
    const current = sessionRef.current;
    if (!current || saving) return;
    const value = rawValue === "" ? "" : normalizeCrosswordLetter(rawValue);
    if (value === null) {
      setNotice("Introduce una sola letra. La Ñ se conserva y las tildes se aceptan.");
      return;
    }
    const event: CrosswordProgressEvent = {
      cellId,
      clientEventId: crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Math.round(performance.now() - changedAt.current)),
      value,
    };
    const nextEntry = preferredEntry(
      current.playing.crossword,
      nextCellId,
      current.playing.activeEntryId,
    );
    const next: SessionState = {
      pendingEvents: [...current.pendingEvents, event],
      playing: {
        ...current.playing,
        activeCellId: nextCellId,
        activeEntryId: nextEntry.id,
        attempt: applyCrosswordEvents(current.playing.attempt, [event]),
      },
      syncStatus: "syncing",
    };
    changedAt.current = performance.now();
    updateSession(next);
    await sync();
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, cellId: string) {
    const current = sessionRef.current;
    if (!current || saving) return;
    const currentEntry = entryById(current.playing.crossword, current.playing.activeEntryId);
    const currentValues = new Map(
      current.playing.attempt.cells.map((cell) => [cell.cellId, cell.value]),
    );
    const key = event.key;
    if (key === " ") {
      event.preventDefault();
      selectCell(cellId);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      const entries = current.playing.crossword.entries;
      const index = entries.findIndex((entry) => entry.id === current.playing.activeEntryId);
      const next = entries[(index + (event.shiftKey ? -1 : 1) + entries.length) % entries.length]!;
      updateSession({
        ...current,
        playing: { ...current.playing, activeCellId: next.cellIds[0]!, activeEntryId: next.id },
      });
      return;
    }
    if (key.startsWith("Arrow")) {
      event.preventDefault();
      const target = adjacentCell(current.playing.crossword, cellId, key);
      if (target) selectCell(target.id);
      return;
    }
    if (key === "Backspace") {
      event.preventDefault();
      const previous = previousCell(currentEntry, cellId);
      void writeCell(currentValues.has(cellId) ? cellId : previous, "", previous);
      return;
    }
    const value = normalizeCrosswordLetter(key);
    if (value) {
      event.preventDefault();
      void writeCell(cellId, value, nextCell(currentEntry, cellId));
    }
  }

  async function submit() {
    const current = sessionRef.current;
    if (!current || saving || syncingRef.current) return;
    if (
      filled < playing.crossword.cells.length &&
      !window.confirm("Quedan celdas vacías. ¿Enviar igualmente?")
    ) {
      return;
    }
    setSaving(true);
    let ready = current;
    try {
      if (ready.pendingEvents.length) ready = await sendPending(ready);
      const response = await fetch(
        `/api/player/attempts/${ready.playing.attempt.attemptId}/submit`,
        { method: "POST" },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isCrosswordSubmitResult(body)) throw new Error("submit");
      removeCrosswordDraft(gameId);
      setResult(body);
      void trackAnalytics("GameCompleted", {
        aidsCount: ready.playing.attempt.hintsUsed,
        attemptId: body.attemptId,
        competitive: body.competitive,
        durationBucket: durationBucket(Date.now() - startedAt.current),
        gameType: "crossword",
        gameId,
        scoreBucket: scoreBucket(body.provisional.score),
      });
      setNotice(undefined);
    } catch {
      updateSession({ ...ready, syncStatus: ready.pendingEvents.length ? "pending" : "saved" });
      setNotice("No se pudo finalizar. Las letras siguen guardadas en este dispositivo.");
    } finally {
      setSaving(false);
    }
  }

  async function revealActiveCell() {
    const current = sessionRef.current;
    if (!current || saving || syncingRef.current) return;
    if (
      !window.confirm("Esta ayuda revela una letra y convierte el intento en casual. ¿Continuar?")
    ) {
      return;
    }
    setSaving(true);
    let ready = current;
    try {
      if (ready.pendingEvents.length) ready = await sendPending(ready);
      const response = await fetch(
        `/api/player/attempts/${ready.playing.attempt.attemptId}/hints`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cellId: ready.playing.activeCellId,
            clientEventId: crypto.randomUUID(),
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isCrosswordHintResult(body)) throw new Error("hint");
      const cells = new Map(ready.playing.attempt.cells.map((cell) => [cell.cellId, cell]));
      cells.set(body.cellId, { cellId: body.cellId, elapsedMs: 0, value: body.value });
      updateSession({
        pendingEvents: [],
        playing: {
          ...ready.playing,
          attempt: {
            ...ready.playing.attempt,
            cells: [...cells.values()],
            hintsUsed: body.hintsUsed,
            version: body.version,
          },
        },
        syncStatus: "saved",
      });
      setNotice("Letra revelada. Este intento ya es casual y no entra en la clasificación.");
    } catch {
      updateSession(ready);
      setNotice("La ayuda necesita conexión. Tus letras siguen guardadas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">{playing.crossword.title}</p>
      <p aria-live="polite" className={`sync-status ${session.syncStatus}`}>
        {session.syncStatus === "saved"
          ? "Progreso guardado"
          : session.syncStatus === "syncing"
            ? "Guardando…"
            : "Sin conexión · pendiente de sincronizar"}
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      <p className="progress">
        {filled} de {playing.crossword.cells.length} celdas · {directionLabel(activeEntry)}{" "}
        {activeEntry.number}
      </p>
      <h1>{activeEntry.clue}</h1>

      <div
        aria-label="Cuadrícula del crucigrama"
        className="crossword-grid"
        role="grid"
        style={{ gridTemplateColumns: `repeat(${playing.crossword.columns}, 1fr)` }}
      >
        {Array.from({ length: playing.crossword.rows * playing.crossword.columns }, (_, index) => {
          const row = Math.floor(index / playing.crossword.columns);
          const column = index % playing.crossword.columns;
          const cell = playing.crossword.cells.find(
            (candidate) => candidate.row === row && candidate.column === column,
          );
          if (!cell)
            return <span aria-hidden="true" className="crossword-block" key={`${row}:${column}`} />;
          const cellEntries = entriesForCell(playing.crossword, cell.id);
          const value = values.get(cell.id) ?? "";
          return (
            <button
              aria-label={`Fila ${row + 1}, columna ${column + 1}${cell.number ? `, número ${cell.number}` : ""}, ${cellEntries.map(directionLabel).join(" y ")}, ${value ? `letra ${value}` : "vacía"}`}
              aria-selected={cell.id === playing.activeCellId}
              className={
                cell.id === playing.activeCellId ? "crossword-cell active" : "crossword-cell"
              }
              key={cell.id}
              onClick={() => selectCell(cell.id)}
              onKeyDown={(event) => handleKey(event, cell.id)}
              ref={(element) => {
                if (
                  element &&
                  cell.id === playing.activeCellId &&
                  document.activeElement?.closest(".crossword-grid")
                ) {
                  element.focus();
                }
              }}
              role="gridcell"
              tabIndex={cell.id === playing.activeCellId ? 0 : -1}
              type="button"
            >
              {cell.number ? <span className="crossword-number">{cell.number}</span> : null}
              <span aria-hidden="true" className="crossword-letter">
                {value}
              </span>
            </button>
          );
        })}
      </div>

      <section aria-labelledby="clues-heading" className="clues-panel">
        <h2 id="clues-heading">Pistas y campos accesibles</h2>
        {playing.crossword.entries.map((entry) => (
          <div className="clue-field" key={entry.id}>
            <p>
              {entry.number} {directionLabel(entry)}. {entry.clue}
            </p>
            <div className="clue-letter-fields">
              {entry.cellIds.map((cellId, index) => (
                <input
                  aria-label={`Letra ${index + 1} de ${entry.cellIds.length}, ${entry.number} ${directionLabel(entry)}. ${entry.clue}`}
                  autoComplete="off"
                  key={cellId}
                  maxLength={2}
                  onChange={(event) =>
                    void writeCell(cellId, event.target.value, nextCell(entry, cellId))
                  }
                  onFocus={() => selectEntryCell(entry.id, cellId)}
                  spellCheck={false}
                  value={values.get(cellId) ?? ""}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {session.syncStatus === "pending" ? (
        <button disabled={saving} onClick={() => void sync()} type="button">
          Sincronizar
        </button>
      ) : null}
      <div className="crossword-actions">
        <button
          disabled={saving || session.syncStatus === "syncing"}
          onClick={() => void revealActiveCell()}
          type="button"
        >
          Revelar letra · partida casual
        </button>
        <button
          disabled={saving}
          onClick={() =>
            setNotice(
              filled === playing.crossword.cells.length
                ? "Todas las celdas tienen un formato válido. La corrección llegará tras el cierre."
                : `Quedan ${playing.crossword.cells.length - filled} celdas vacías.`,
            )
          }
          type="button"
        >
          Comprobar formato
        </button>
        <button
          disabled={saving || session.syncStatus === "syncing"}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "Guardando…" : "Finalizar"}
        </button>
      </div>
    </main>
  );
}

async function start(
  gameId: string,
  signal: AbortSignal,
  canRenewGuestSession = true,
): Promise<SessionState> {
  const cached = readCrosswordDraft(gameId);
  try {
    if (!(await ensurePlayerSession(signal))) throw new Error("offline");
    const gameResponse = await fetch(`/api/player/games/${gameId}`, { signal });
    if (!gameResponse.ok) throw new Error(gameResponse.status === 404 ? "game" : "offline");
    const game: unknown = await gameResponse.json();
    if (!isPublicCrosswordGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`/api/player/games/${gameId}/attempts`, {
      method: "POST",
      signal,
    });
    if (
      attemptResponse.status === 401 &&
      canRenewGuestSession &&
      (await renewGuestSession(signal))
    ) {
      return start(gameId, signal, false);
    }
    if (!attemptResponse.ok) throw new Error("offline");
    const attempt: unknown = await attemptResponse.json();
    if (!isCrosswordAttemptState(attempt)) throw new Error("attempt");
    const cacheMatches =
      cached?.attempt.attemptId === attempt.attemptId &&
      cached.contentVersion === game.contentVersion;
    const pendingEvents = cacheMatches ? cached.pendingEvents : [];
    const mergedAttempt = applyCrosswordEvents(attempt, pendingEvents);
    const selection = validSelection(
      game.payload,
      cacheMatches ? cached.activeCellId : undefined,
      cacheMatches ? cached.activeEntryId : undefined,
    );
    return {
      pendingEvents,
      playing: {
        ...selection,
        attempt: mergedAttempt,
        contentVersion: game.contentVersion,
        crossword: game.payload,
      },
      syncStatus: pendingEvents.length ? "pending" : "saved",
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message === "game") throw cause;
    if (!cached) throw cause;
    return {
      pendingEvents: cached.pendingEvents,
      playing: {
        activeCellId: cached.activeCellId,
        activeEntryId: cached.activeEntryId,
        attempt: cached.attempt,
        contentVersion: cached.contentVersion,
        crossword: cached.crossword,
      },
      syncStatus: cached.pendingEvents.length ? "pending" : "saved",
    };
  }
}

async function sendPending(session: SessionState): Promise<SessionState> {
  if (!session.pendingEvents.length) return { ...session, syncStatus: "saved" };
  const attempt = await synchronizeCrosswordProgress(
    session.playing.attempt,
    session.pendingEvents,
    async (version, events) => {
      const response = await fetch(
        `/api/player/attempts/${session.playing.attempt.attemptId}/progress`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events, version }),
        },
      );
      const body: unknown = await response.json();
      if (response.status === 409 && isCrosswordProgressConflict(body)) return body;
      if (!response.ok || !isCrosswordProgressSaved(body)) throw new Error("sync");
      return body;
    },
  );
  return {
    pendingEvents: [],
    playing: { ...session.playing, attempt },
    syncStatus: "saved",
  };
}

function toDraft(gameId: string, session: SessionState): CrosswordLocalDraft {
  return {
    activeCellId: session.playing.activeCellId,
    activeEntryId: session.playing.activeEntryId,
    attempt: session.playing.attempt,
    contentVersion: session.playing.contentVersion,
    crossword: session.playing.crossword,
    gameId,
    pendingEvents: session.pendingEvents,
    savedAt: new Date().toISOString(),
  };
}

function validSelection(
  crossword: CrosswordPublicPayload,
  cellId?: string,
  entryId?: string,
): { activeCellId: string; activeEntryId: string } {
  const entry = crossword.entries.find(
    (candidate) => candidate.id === entryId && candidate.cellIds.includes(cellId ?? ""),
  );
  if (entry && cellId) return { activeCellId: cellId, activeEntryId: entry.id };
  const first = crossword.entries[0]!;
  return { activeCellId: first.cellIds[0]!, activeEntryId: first.id };
}

function entryById(crossword: CrosswordPublicPayload, entryId: string): CrosswordEntryPublic {
  return crossword.entries.find((entry) => entry.id === entryId) ?? crossword.entries[0]!;
}

function entriesForCell(crossword: CrosswordPublicPayload, cellId: string) {
  return crossword.entries.filter((entry) => entry.cellIds.includes(cellId));
}

function preferredEntry(crossword: CrosswordPublicPayload, cellId: string, entryId: string) {
  const entries = entriesForCell(crossword, cellId);
  return entries.find((entry) => entry.id === entryId) ?? entries[0]!;
}

function nextCell(entry: CrosswordEntryPublic, cellId: string): string {
  const index = entry.cellIds.indexOf(cellId);
  return entry.cellIds[Math.min(index + 1, entry.cellIds.length - 1)]!;
}

function previousCell(entry: CrosswordEntryPublic, cellId: string): string {
  const index = entry.cellIds.indexOf(cellId);
  return entry.cellIds[Math.max(0, index - 1)]!;
}

function adjacentCell(crossword: CrosswordPublicPayload, cellId: string, key: string) {
  const cell = crossword.cells.find((candidate) => candidate.id === cellId);
  if (!cell) return undefined;
  const deltas: Record<string, readonly [number, number]> = {
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
  };
  const [rowDelta, columnDelta] = deltas[key] ?? [0, 0];
  return crossword.cells.find(
    (candidate) =>
      candidate.row === cell.row + rowDelta && candidate.column === cell.column + columnDelta,
  );
}

function directionLabel(entry: CrosswordEntryPublic) {
  return entry.direction === "across" ? "Horizontal" : "Vertical";
}

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message === "game"
    ? "Este crucigrama no está disponible ahora mismo."
    : "Este crucigrama no se ha descargado todavía y ahora no hay conexión.";
}
