"use client";

import {
  isGuessWordAttemptState,
  isGuessWordGuessResult,
  isPublicGuessWordGame,
  type GuessWordGuessEvent,
  type GuessWordLocalDraft,
  type GuessWordAttemptState,
  type GuessWordPublicPayload,
} from "@ludico/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { LeaderboardPanel } from "../../leaderboard-panel";
import { ShareButton } from "../../share-button";
import {
  readGuessWordDraft,
  removeGuessWordDraft,
  writeGuessWordDraft,
} from "./guess-word-storage";

type Session = {
  attempt: GuessWordAttemptState;
  contentVersion: number;
  game: GuessWordPublicPayload;
  pendingEvents: readonly GuessWordGuessEvent[];
};

export function GuessWordPlayer({ gameId }: Readonly<{ gameId: string }>) {
  const [session, setSession] = useState<Session>();
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void start(gameId, controller.signal)
      .then((state) => {
        startedAt.current = Date.now();
        setSession(state);
        void trackAnalytics("GameStarted", {
          attemptId: state.attempt.attemptId,
          entryPoint: state.attempt.guesses.length ? "resume" : "daily",
          gameId,
          gameType: "guess_word",
          offline: !navigator.onLine,
          platform: "web",
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("No hemos podido abrir este reto.");
      });
    return () => controller.abort();
  }, [gameId]);

  useEffect(() => {
    if (!session) return;
    writeGuessWordDraft(toDraft(gameId, session));
  }, [gameId, session]);

  useEffect(() => {
    if (!session?.pendingEvents.length) return;
    const syncOnReconnect = () => void syncPending(session);
    window.addEventListener("online", syncOnReconnect);
    return () => window.removeEventListener("online", syncOnReconnect);
  }, [session]);

  function syncPending(source: Session) {
    void sync(source)
      .then((next) => setSession(next))
      .catch(() => setNotice("El intento sigue pendiente de sincronizar."));
  }

  async function submit() {
    if (!session || saving || !value.trim()) return;
    setSaving(true);
    setNotice(undefined);
    const event: GuessWordGuessEvent = {
      clientEventId: crypto.randomUUID(),
      clientOccurredAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - startedAt.current),
      guess: value,
      version: session.attempt.version,
    };
    try {
      const ready = session.pendingEvents.length ? await sync(session) : session;
      const next = await sendGuess(ready, event);
      setSession(next);
      setValue("");
      const outcome = next.attempt.result ? "complete" : "incorrect";
      if (outcome === "incorrect") {
        setNotice("No es la palabra. Prueba de nuevo o consulta la siguiente pista.");
        return;
      }
      if (next.attempt.result) {
        removeGuessWordDraft(gameId);
        void trackAnalytics("GameCompleted", {
          aidsCount: 0,
          attemptId: next.attempt.attemptId,
          competitive: next.attempt.result.competitive,
          durationBucket: durationBucket(Date.now() - startedAt.current),
          gameId,
          gameType: "guess_word",
          scoreBucket: scoreBucket(next.attempt.result.provisional.score),
        });
      }
      setNotice("Reto enviado. La solución se publicará al cierre de la edición.");
    } catch {
      setSession({ ...session, pendingEvents: [...session.pendingEvents, event] });
      setValue("");
      setNotice("Intento guardado. Se comprobará automáticamente al recuperar la conexión.");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <main className="play-page">
        <p role="alert">{error}</p>
        <Link className="button-link" href="/">
          Volver al inicio
        </Link>
      </main>
    );
  }
  if (!session) {
    return (
      <main aria-busy="true" className="play-page">
        <p className="eyebrow">Adivina la palabra</p>
        <h1>Preparando el reto{"\u2026"}</h1>
      </main>
    );
  }

  const { attempt, game } = session;
  const completed = attempt.status === "accepted";
  const pending = session.pendingEvents.length > 0;
  const visibleHints = game.hints.filter(
    (hint) => hint.unlockAfterAttempts <= attempt.guesses.length,
  );
  return (
    <main className="play-page quiz-page">
      <header className="play-topbar">
        <Link aria-label="Volver a los retos" className="play-topbar__back" href="/">
          {"\u2190"}
        </Link>
        <Link className="play-topbar__brand" href="/">
          L{"\u00fa"}dico
        </Link>
        <span className="play-topbar__status">Adivina la palabra</span>
      </header>
      <section className="quiz-card">
        <p className="eyebrow">{game.category}</p>
        <h1>{game.definition}</h1>
        <p>
          Intentos: {attempt.guesses.length} de {game.maxAttempts}
        </p>
        <label className="account-form">
          Escribe tu respuesta
          <input
            autoCapitalize="characters"
            autoComplete="off"
            disabled={completed || saving || pending}
            maxLength={21}
            onChange={(event) => setValue(event.target.value.toLocaleUpperCase("es-ES"))}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            value={value}
          />
        </label>
        <button
          className="primary-action"
          disabled={completed || saving || pending || !value.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "Comprobando\u2026" : pending ? "Intento pendiente" : "Comprobar palabra"}
        </button>
        {pending ? (
          <button disabled={saving} onClick={() => syncPending(session)} type="button">
            Sincronizar intento
          </button>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {visibleHints.length ? (
          <section aria-labelledby="hints-heading">
            <h2 id="hints-heading">Pistas</h2>
            <ol className="review-list">
              {visibleHints.map((hint) => (
                <li key={`${hint.unlockAfterAttempts}:${hint.text}`}>{hint.text}</li>
              ))}
            </ol>
          </section>
        ) : null}
        {attempt.guesses.length ? (
          <p>Palabras probadas: {attempt.guesses.map((guess) => guess.guess).join(", ")}</p>
        ) : null}
      </section>
      {attempt.result ? (
        <section className="personal-review">
          <h2>{attempt.result.provisional.score} puntos</h2>
          <p>Las soluciones estar\u00e1n disponibles al cerrar la edici\u00f3n.</p>
          <LeaderboardPanel gameId={gameId} />
          <ShareButton attemptId={attempt.attemptId} />
          <Link
            className="button-link"
            href={`/resultados/${gameId}?attemptId=${attempt.attemptId}`}
          >
            Ver revisi\u00f3n al cierre
          </Link>
        </section>
      ) : null}
    </main>
  );
}

async function start(
  gameId: string,
  signal: AbortSignal,
  canRenewGuestSession = true,
): Promise<Session> {
  const cached = readGuessWordDraft(gameId);
  try {
    if (!(await ensurePlayerSession(signal))) throw new Error("session");
    const gameResponse = await fetch(`/api/player/games/${gameId}`, { signal });
    const game: unknown = await gameResponse.json();
    if (!gameResponse.ok || !isPublicGuessWordGame(game)) throw new Error("game");
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
    const attempt: unknown = await attemptResponse.json();
    if (!attemptResponse.ok || !isGuessWordAttemptState(attempt)) throw new Error("attempt");
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
  let next = { ...session, pendingEvents: [] as readonly GuessWordGuessEvent[] };
  for (const event of session.pendingEvents) next = await sendGuess(next, event);
  return next;
}

async function sendGuess(session: Session, event: GuessWordGuessEvent): Promise<Session> {
  const response = await fetch(`/api/player/attempts/${session.attempt.attemptId}/guesses`, {
    body: JSON.stringify({ ...event, version: session.attempt.version }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body: unknown = await response.json();
  if (!response.ok || !isGuessWordGuessResult(body)) throw new Error("guess");
  return { ...session, attempt: body.attempt };
}

function toDraft(gameId: string, session: Session): GuessWordLocalDraft {
  return {
    attempt: session.attempt,
    contentVersion: session.contentVersion,
    game: session.game,
    gameId,
    pendingEvents: session.pendingEvents,
    savedAt: new Date().toISOString(),
  };
}
