import { isPreviousResultSummaries, type PreviousResultSummary } from "@ludico/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getPlayerHeaders } from "./player-auth";

export function PreviousResultsPanel() {
  const router = useRouter();
  const [results, setResults] = useState<PreviousResultSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void load(controller.signal).then(setResults);
      return () => controller.abort();
    }, []),
  );

  if (results.length === 0) return null;
  return (
    <View accessibilityLabel="Tu resultado de ayer" style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Tu resultado de ayer
      </Text>
      {results.map((result) => (
        <View key={result.attemptId} style={styles.result}>
          <Text style={styles.body}>
            {result.gameType === "quiz"
              ? "Quiz"
              : result.gameType === "true_false"
                ? "Verdadero o falso"
                : result.gameType === "guess_word"
                  ? "Adivina la palabra"
                  : "Crucigrama"}
            : {result.points} puntos
            {result.rank && result.total
              ? ` · puesto ${result.rank} de ${result.total}`
              : " · casual"}
          </Text>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({
                pathname: "/review/[gameId]",
                params: { attemptId: result.attemptId, gameId: result.gameId },
              })
            }
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <Text style={styles.linkText}>Revisar mi partida</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

async function load(signal: AbortSignal): Promise<PreviousResultSummary[]> {
  const headers = await getPlayerHeaders(signal);
  if (!headers || !("Authorization" in headers)) return [];
  try {
    const response = await fetch(`${apiUrl()}/me/previous-results`, { headers, signal });
    const body: unknown = await response.json();
    return response.ok && isPreviousResultSummaries(body) ? body : [];
  } catch {
    return [];
  }
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 17, lineHeight: 24 },
  container: {
    alignSelf: "stretch",
    borderColor: "#71809c",
    borderWidth: 2,
    gap: 10,
    marginVertical: 16,
    padding: 16,
  },
  link: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  linkText: { color: "#a83242", fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.8 },
  result: { gap: 4 },
  title: { color: "#17233c", fontSize: 24, fontWeight: "700" },
});
