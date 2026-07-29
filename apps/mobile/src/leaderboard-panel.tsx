import { isLeaderboard, type Leaderboard } from "@ludico/contracts";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders } from "./player-auth";

export function LeaderboardPanel({ gameId }: Readonly<{ gameId: string }>) {
  const [leaderboard, setLeaderboard] = useState<Leaderboard>();

  useEffect(() => {
    const controller = new AbortController();
    void load(gameId, controller.signal).then((value) => {
      if (value) setLeaderboard(value);
    });
    return () => controller.abort();
  }, [gameId]);

  if (!leaderboard) return null;
  return (
    <View accessibilityLabel="Clasificación" style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Clasificación
      </Text>
      <Text style={styles.body}>
        {leaderboard.own
          ? `Tu puesto: ${leaderboard.own.rank} de ${leaderboard.own.total} · percentil ${leaderboard.own.percentile}`
          : "Este intento no tiene una posición competitiva."}
      </Text>
      {leaderboard.entries.map((entry) => (
        <Text key={`${entry.rank}:${entry.alias}`} style={styles.body}>
          {entry.rank}. {entry.alias} · {entry.points} puntos
        </Text>
      ))}
    </View>
  );
}

async function load(gameId: string, signal: AbortSignal): Promise<Leaderboard | null> {
  const headers = await getPlayerHeaders(signal);
  if (!headers) return null;
  try {
    const response = await fetch(`${apiUrl()}/leaderboards/game/${gameId}`, { headers, signal });
    const body: unknown = await response.json();
    return response.ok && isLeaderboard(body) ? body : null;
  } catch {
    return null;
  }
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 17, lineHeight: 24 },
  container: { alignSelf: "stretch", borderColor: "#71809c", borderWidth: 2, gap: 8, padding: 16 },
  title: { color: "#17233c", fontSize: 24, fontWeight: "700" },
});
