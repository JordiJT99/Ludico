"use client";

import { isLeaderboard, type Leaderboard } from "@ludico/contracts";
import { useEffect, useState } from "react";

export function LeaderboardPanel({ gameId }: Readonly<{ gameId: string }>) {
  const [leaderboard, setLeaderboard] = useState<Leaderboard>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/player/leaderboards/game/${gameId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (response.ok && isLeaderboard(body)) setLeaderboard(body);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [gameId]);

  if (!leaderboard) return null;
  return (
    <section aria-labelledby="leaderboard-heading" className="leaderboard-panel">
      <h2 id="leaderboard-heading">Clasificación</h2>
      {leaderboard.own ? (
        <p>
          Tu puesto: <strong>{leaderboard.own.rank}</strong> de {leaderboard.own.total} · percentil{" "}
          {leaderboard.own.percentile}
        </p>
      ) : (
        <p>Este intento no tiene una posición competitiva.</p>
      )}
      {leaderboard.entries.length ? (
        <ol className="leaderboard-list">
          {leaderboard.entries.map((entry) => (
            <li key={`${entry.rank}:${entry.alias}`} value={entry.rank}>
              <strong>{entry.alias}</strong> · {entry.points} puntos ·{" "}
              {formatDuration(entry.durationMs)}
            </li>
          ))}
        </ol>
      ) : (
        <p>Nadie ha elegido mostrar un alias todavía.</p>
      )}
    </section>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1_000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
