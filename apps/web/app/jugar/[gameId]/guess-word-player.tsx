"use client";

import {
  isGuessWordAttemptState,
  isGuessWordGuessResult,
  isPublicGuessWordGame,
  type GuessWordAttemptState,
  type GuessWordPublicPayload,
} from "@ludico/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { durationBucket, scoreBucket, trackAnalytics } from "../../analytics";
import { ensurePlayerSession, renewGuestSession } from "../../player-session";
import { LeaderboardPanel } from "../../leaderboard-panel";
import { ShareButton } from "../../share-button";

type Session = {
  attempt: GuessWordAttemptState;
  game: GuessWordPublicPayload;
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

  async function submit() {
    if (!session || saving || !value.trim()) return;
    setSaving(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/player/attempts/${session.attempt.attemptId}/guesses`, {
        body: JSON.stringify({
          clientEventId: crypto.randomUUID(),
          clientOccurredAt: new Date().toISOString(),
          elapsedMs: Math.max(0, Date.now() - startedAt.current),
          guess: value,
          version: session.attempt.version,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok || !isGuessWordGuessResult(body)) throw new Error("guess");
      const next = { ...session, attempt: body.attempt };
      setSession(next);
      setValue("");
      if (body.outcome === "incorrect") {
        setNotice("No es la palabra. Prueba de nuevo o consulta la siguiente pista.");
        return;
      }
      if (body.attempt.result) {
        void trackAnalytics("GameCompleted", {
          aidsCount: 0,
          attemptId: body.attempt.attemptId,
          competitive: body.attempt.result.competitive,
          durationBucket: durationBucket(Date.now() - startedAt.current),
          gameId,
          gameType: "guess_word",
          scoreBucket: scoreBucket(body.attempt.result.provisional.score),
        });
      }
      setNotice(
        body.outcome === "correct"
          ? "Â¡Correcto! Has resuelto el reto."
          : "Se han acabado los intentos. La soluciÃ³n se publicarÃ¡ al cierre de la ediciÃ³n.",
      );
    } catch {
      setNotice("No se ha podido enviar el intento. Comprueba tu conexiÃ³n y vuelve a intentarlo.");
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
        <h1>Preparando el retoâ€¦</h1>
      </main>
    );
  }

  const { attempt, game } = session;
  const completed = attempt.status === "accepted";
  const visibleHints = game.hints.filter(
    (hint) => hint.unlockAfterAttempts <= attempt.guesses.length,
  );
  return (
    <main className="play-page quiz-page">
      <header className="play-topbar">
        <Link aria-label="Volver a los retos" className="play-topbar__back" href="/">
          â†
        </Link>
        <Link className="play-topbar__brand" href="/">
          LÃºdico
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
            disabled={completed || saving}
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
          disabled={completed || saving || !value.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? "Comprobandoâ€¦" : "Comprobar palabra"}
        </button>
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
          <p>Las soluciones estarÃ¡n disponibles al cerrar la ediciÃ³n.</p>
          <LeaderboardPanel gameId={gameId} />
          <ShareButton attemptId={attempt.attemptId} />
          <Link
            className="button-link"
            href={`/resultados/${gameId}?attemptId=${attempt.attemptId}`}
          >
            Ver revisiÃ³n al cierre
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
  if (!(await ensurePlayerSession(signal))) throw new Error("session");
  const gameResponse = await fetch(`/api/player/games/${gameId}`, { signal });
  const game: unknown = await gameResponse.json();
  if (!gameResponse.ok || !isPublicGuessWordGame(game)) throw new Error("game");
  const attemptResponse = await fetch(`/api/player/games/${gameId}/attempts`, {
    method: "POST",
    signal,
  });
  if (attemptResponse.status === 401 && canRenewGuestSession && (await renewGuestSession(signal))) {
    return start(gameId, signal, false);
  }
  const attempt: unknown = await attemptResponse.json();
  if (!attemptResponse.ok || !isGuessWordAttemptState(attempt)) throw new Error("attempt");
  return { attempt, game: game.payload };
}
