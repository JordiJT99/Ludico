"use client";

import {
  isPublicWordSearchGame,
  isWordSearchAttemptState,
  isWordSearchSelectionResult,
  type WordSearchAttemptState,
  type WordSearchLocalDraft,
  type WordSearchPublicPayload,
  type WordSearchSelectionEvent,
} from "@ludico/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";
import {
  readWordSearchDraft,
  removeWordSearchDraft,
  writeWordSearchDraft,
} from "./word-search-storage";

type Session = {
  attempt: WordSearchAttemptState;
  contentVersion: number;
  game: WordSearchPublicPayload;
  pendingEvents: readonly WordSearchSelectionEvent[];
};
type Coordinate = { column: number; row: number };

export function WordSearchPlayer({ gameId }: Readonly<{ gameId: string }>) {
  const [session, setSession] = useState<Session>();
  const [selectedWordId, setSelectedWordId] = useState<string>();
  const [start, setStart] = useState<Coordinate>();
  const [notice, setNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void startGame(gameId, controller.signal)
      .then((state) => {
        startedAt.current = Date.now();
        setSession(state);
        void trackAnalytics("GameStarted", {
          entryPoint: state.attempt.foundEntries.length ? "resume" : "daily",
          gameId,
          gameType: "word_search",
          offline: !navigator.onLine,
          platform: "web",
        });
      })
      .catch(() => setNotice("No hemos podido abrir este reto."));
    return () => controller.abort();
  }, [gameId]);

  useEffect(() => {
    if (!session) return;
    writeWordSearchDraft(toDraft(gameId, session));
  }, [gameId, session]);

  useEffect(() => {
    if (!session?.pendingEvents.length) return;
    const syncOnReconnect = () => syncPending(session);
    window.addEventListener("online", syncOnReconnect);
    return () => window.removeEventListener("online", syncOnReconnect);
  }, [session]);

  function syncPending(source: Session) {
    void sync(source)
      .then((next) => {
        setSession(next);
        setNotice("Selección sincronizada.");
      })
      .catch(() => setNotice("La selección sigue pendiente de sincronizar."));
  }

  async function chooseCell(coordinate: Coordinate) {
    if (
      !session ||
      saving ||
      session.pendingEvents.length ||
      session.attempt.status !== "in_progress"
    )
      return;
    if (!selectedWordId) return setNotice("Elige primero una palabra de la lista.");
    if (!start) return setStart(coordinate);
    setSaving(true);
    const event: WordSearchSelectionEvent = {
      clientEventId: crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - startedAt.current),
      endColumn: coordinate.column,
      endRow: coordinate.row,
      entryId: selectedWordId,
      startColumn: start.column,
      startRow: start.row,
      version: session.attempt.version,
    };
    try {
      const ready = session.pendingEvents.length ? await sync(session) : session;
      const result = await sendSelection(ready, event);
      setSession(result.session);
      if (result.session.attempt.result) {
        removeWordSearchDraft(gameId);
        void trackAnalytics("GameCompleted", {
          competitive: result.session.attempt.result.competitive,
          durationBucket: durationBucket(Date.now() - startedAt.current),
          gameId,
          gameType: "word_search",
          scoreBucket: scoreBucket(result.session.attempt.result.provisional.score),
        });
      }
      setStart(undefined);
      setNotice(
        result.outcome === "found"
          ? "Palabra encontrada."
          : result.outcome === "already_found"
            ? "Esa palabra ya estaba encontrada."
            : "Esa selección no coincide. Prueba de nuevo.",
      );
    } catch {
      setSession({ ...session, pendingEvents: [...session.pendingEvents, event] });
      setStart(undefined);
      setNotice("Selección guardada. Se comprobará automáticamente al recuperar la conexión.");
    } finally {
      setSaving(false);
    }
  }

  if (!session)
    return (
      <main className="play-page">
        <p>{notice ?? "Preparando la sopa de letras…"}</p>
      </main>
    );
  const found = new Set(session.attempt.foundEntries.map((entry) => entry.entryId));
  const pending = session.pendingEvents.length > 0;
  return (
    <main className="play-page">
      <header className="play-topbar">
        <Link className="play-topbar__brand" href="/">
          Lúdico
        </Link>
        <span className="play-topbar__status">Sopa de letras</span>
      </header>
      <h1>{session.game.title}</h1>
      <p>Elige una palabra y marca su primera y última letra.</p>
      <div
        aria-label="Sopa de letras"
        className="crossword-grid"
        style={{ gridTemplateColumns: `repeat(${session.game.columns}, 1fr)` }}
      >
        {session.game.grid.flatMap((row, rowIndex) =>
          row.map((letter, column) => {
            const active = start?.row === rowIndex && start.column === column;
            return (
              <button
                aria-label={`Fila ${rowIndex + 1}, columna ${column + 1}: ${letter}`}
                className={active ? "crossword-cell active" : "crossword-cell"}
                key={`${rowIndex}:${column}`}
                onClick={() => void chooseCell({ row: rowIndex, column })}
                type="button"
              >
                {letter}
              </button>
            );
          }),
        )}
      </div>
      <section aria-label="Palabras por encontrar" className="options">
        {session.game.words.map((word) => (
          <button
            className={
              found.has(word.id)
                ? "option selected"
                : selectedWordId === word.id
                  ? "option selected"
                  : "option"
            }
            disabled={pending || found.has(word.id) || session.attempt.status !== "in_progress"}
            key={word.id}
            onClick={() => {
              setSelectedWordId(word.id);
              setStart(undefined);
            }}
            type="button"
          >
            {word.answer}
            {found.has(word.id) ? " ✓" : ""}
          </button>
        ))}
      </section>
      {pending ? (
        <button disabled={saving} onClick={() => syncPending(session)} type="button">
          Sincronizar selección
        </button>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {session.attempt.result ? (
        <>
          <h2>{session.attempt.result.provisional.score} puntos</h2>
          <p>Las soluciones estarán disponibles al cerrar la edición.</p>
          <Link
            className="button-link"
            href={`/resultados/${gameId}?attemptId=${session.attempt.attemptId}`}
          >
            Ver revisión al cierre
          </Link>
        </>
      ) : null}
    </main>
  );
}

async function startGame(gameId: string, signal: AbortSignal, canRenew = true): Promise<Session> {
  const cached = readWordSearchDraft(gameId);
  try {
    if (!(await ensurePlayerSession(signal))) throw new Error("session");
    const gameResponse = await fetch(`/api/player/games/${gameId}`, { signal });
    const game: unknown = await gameResponse.json();
    if (!gameResponse.ok || !isPublicWordSearchGame(game)) throw new Error("game");
    const attemptResponse = await fetch(`/api/player/games/${gameId}/attempts`, {
      method: "POST",
      signal,
    });
    if (attemptResponse.status === 401 && canRenew && (await renewGuestSession(signal)))
      return startGame(gameId, signal, false);
    const attempt: unknown = await attemptResponse.json();
    if (!attemptResponse.ok || !isWordSearchAttemptState(attempt)) throw new Error("attempt");
    return {
      attempt,
      contentVersion: game.contentVersion,
      game: game.payload,
      pendingEvents:
        cached?.attempt.attemptId === attempt.attemptId &&
        cached.contentVersion === game.contentVersion
          ? cached.pendingEvents
          : [],
    };
  } catch {
    if (!cached) throw new Error("session");
    return {
      attempt: cached.attempt,
      contentVersion: cached.contentVersion,
      game: cached.game,
      pendingEvents: cached.pendingEvents,
    };
  }
}

async function sync(session: Session): Promise<Session> {
  let next = { ...session, pendingEvents: [] as readonly WordSearchSelectionEvent[] };
  for (const event of session.pendingEvents) next = (await sendSelection(next, event)).session;
  return next;
}

async function sendSelection(
  session: Session,
  event: WordSearchSelectionEvent,
): Promise<{ outcome: "found" | "incorrect" | "already_found"; session: Session }> {
  const response = await fetch(
    `/api/player/attempts/${session.attempt.attemptId}/word-search-selections`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, version: session.attempt.version }),
    },
  );
  const body: unknown = await response.json();
  if (!response.ok || !isWordSearchSelectionResult(body)) throw new Error("selection");
  return { outcome: body.outcome, session: { ...session, attempt: body.attempt } };
}

function toDraft(gameId: string, session: Session): WordSearchLocalDraft {
  return {
    attempt: session.attempt,
    contentVersion: session.contentVersion,
    game: session.game,
    gameId,
    pendingEvents: session.pendingEvents,
    savedAt: new Date().toISOString(),
  };
}
