"use client";

import {
  isPublicWordSearchGame,
  isWordSearchAttemptState,
  isWordSearchSelectionResult,
  type WordSearchAttemptState,
  type WordSearchPublicPayload,
} from "@ludico/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";

type Session = { attempt: WordSearchAttemptState; game: WordSearchPublicPayload };
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

  async function chooseCell(coordinate: Coordinate) {
    if (!session || saving || session.attempt.status !== "in_progress") return;
    if (!selectedWordId) return setNotice("Elige primero una palabra de la lista.");
    if (!start) return setStart(coordinate);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/player/attempts/${session.attempt.attemptId}/word-search-selections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientEventId: crypto.randomUUID(),
            elapsedMs: Math.max(0, Date.now() - startedAt.current),
            entryId: selectedWordId,
            startRow: start.row,
            startColumn: start.column,
            endRow: coordinate.row,
            endColumn: coordinate.column,
            version: session.attempt.version,
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || !isWordSearchSelectionResult(body)) throw new Error("selection");
      setSession({ ...session, attempt: body.attempt });
      if (body.attempt.result) {
        void trackAnalytics("GameCompleted", {
          competitive: body.attempt.result.competitive,
          durationBucket: durationBucket(Date.now() - startedAt.current),
          gameId,
          gameType: "word_search",
          scoreBucket: scoreBucket(body.attempt.result.provisional.score),
        });
      }
      setStart(undefined);
      setNotice(
        body.outcome === "found"
          ? "Palabra encontrada."
          : body.outcome === "already_found"
            ? "Esa palabra ya estaba encontrada."
            : "Esa selección no coincide. Prueba de nuevo.",
      );
    } catch {
      setNotice("No se ha podido comprobar la selección. Vuelve a intentarlo.");
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
            disabled={found.has(word.id) || session.attempt.status !== "in_progress"}
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
  return { attempt, game: game.payload };
}
