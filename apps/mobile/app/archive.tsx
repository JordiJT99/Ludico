import { isPublicEdition, type PublicEdition } from "@ludico/contracts";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function ArchiveScreen() {
  const router = useRouter();
  const [editions, setEditions] = useState<PublicEdition[]>();

  useEffect(() => {
    const controller = new AbortController();
    void loadArchive(controller.signal).then(setEditions);
    return () => controller.abort();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Últimos siete días</Text>
      <Text accessibilityRole="header" style={styles.title}>
        Archivo
      </Text>
      {editions === undefined ? (
        <ActivityIndicator accessibilityLabel="Cargando archivo" color="#a83242" size="large" />
      ) : editions.length === 0 ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Todavía no hay ediciones anteriores disponibles.
        </Text>
      ) : (
        editions.map((edition) => (
          <View key={edition.id} style={styles.card}>
            <Text accessibilityRole="header" style={styles.subtitle}>
              {formatDate(edition.localDate)}
            </Text>
            {edition.games.map((game) => (
              <Pressable
                accessibilityRole="link"
                key={game.id}
                onPress={() =>
                  router.push({ pathname: "/review/[gameId]", params: { gameId: game.id } })
                }
                style={({ pressed }) => [styles.link, pressed && styles.pressed]}
              >
                <Text style={styles.linkText}>
                  Ver solución del {game.type === "quiz" ? "quiz" : "crucigrama"}
                </Text>
              </Pressable>
            ))}
          </View>
        ))
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>Volver</Text>
      </Pressable>
    </ScrollView>
  );
}

async function loadArchive(signal: AbortSignal): Promise<PublicEdition[]> {
  try {
    const todayResponse = await fetch(`${apiUrl()}/editions/today`, { signal });
    const today: unknown = await todayResponse.json();
    if (!todayResponse.ok || !isPublicEdition(today)) return [];
    const dates = Array.from({ length: 7 }, (_, index) => addDays(today.localDate, -(index + 1)));
    const responses = await Promise.all(
      dates.map((date) => fetch(`${apiUrl()}/editions/${date}`, { signal })),
    );
    return (
      await Promise.all(
        responses.map(async (response) => {
          if (!response.ok) return null;
          const body: unknown = await response.json();
          return isPublicEdition(body) ? body : null;
        }),
      )
    ).filter((edition): edition is PublicEdition => edition !== null);
  } catch {
    return [];
  }
}

function addDays(localDate: string, offset: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeZone: "Europe/Madrid",
  }).format(new Date(`${value}T12:00:00Z`));
}

const styles = StyleSheet.create({
  body: { color: "#17233c", fontSize: 17, lineHeight: 24 },
  button: {
    alignItems: "center",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  card: { borderColor: "#71809c", borderWidth: 2, gap: 8, padding: 16 },
  container: { backgroundColor: "#fff9ef", flexGrow: 1, gap: 18, padding: 24, paddingTop: 64 },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  link: { justifyContent: "center", minHeight: 44 },
  linkText: { color: "#a83242", fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.8 },
  subtitle: { color: "#17233c", fontSize: 22, fontWeight: "700" },
  title: { color: "#17233c", fontSize: 32, fontWeight: "700" },
});
