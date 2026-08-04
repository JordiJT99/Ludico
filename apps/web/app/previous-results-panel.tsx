"use client";

import { isPreviousResultSummaries, type PreviousResultSummary } from "@ludico/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";

export function PreviousResultsPanel() {
  const [results, setResults] = useState<readonly PreviousResultSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      void fetch("/api/player/me/previous-results", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const body: unknown = await response.json();
          setResults(response.ok && isPreviousResultSummaries(body) ? body : []);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("ludico:account-changed", load);
    return () => {
      controller.abort();
      window.removeEventListener("ludico:account-changed", load);
    };
  }, []);

  if (!results.length) return null;
  return (
    <section aria-labelledby="personal-yesterday-heading" className="personal-results">
      <h2 id="personal-yesterday-heading">Tu resultado de ayer</h2>
      <div className="games">
        {results.map((result) => (
          <article className="game" key={result.attemptId}>
            <h3>
              {result.gameType === "quiz"
                ? "Quiz"
                : result.gameType === "true_false"
                  ? "Verdadero o falso"
                  : result.gameType === "guess_word"
                    ? "Adivina la palabra"
                    : "Crucigrama"}
            </h3>
            <p>
              <strong>{result.points} puntos</strong>
              {result.rank && result.total ? ` · Puesto ${result.rank} de ${result.total}` : ""}
              {!result.competitive ? " · Partida casual" : ""}
            </p>
            <Link
              className="button-link"
              href={`/resultados/${result.gameId}?attemptId=${result.attemptId}`}
            >
              Revisar mi partida
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
