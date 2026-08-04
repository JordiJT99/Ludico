import type { PublicEdition } from "@ludico/contracts";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ConsentPanel } from "../src/consent-panel";
import { ensureGuestSession } from "../src/guest-session";
import { getAuthClient } from "../src/player-auth";
import { PreviousResultsPanel } from "../src/previous-results-panel";
import { clientPlatform, trackAnalytics } from "../src/analytics";

export default function HomeScreen() {
  const router = useRouter();
  const [edition, setEdition] = useState<PublicEdition | null>();
  const [guestStatus, setGuestStatus] = useState<"account" | "pending" | "ready" | "local-only">(
    "pending",
  );

  useEffect(() => {
    const controller = new AbortController();
    loadEdition(controller.signal).then(setEdition);
    const auth = getAuthClient();
    if (auth) {
      void auth.auth
        .getSession()
        .then(({ data }) =>
          data.session
            ? setGuestStatus("account")
            : ensureGuestSession(controller.signal).then(setGuestStatus),
        );
    } else {
      ensureGuestSession(controller.signal).then(setGuestStatus);
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!edition) return;
    void trackAnalytics("DailyEditionViewed", {
      availability: "available",
      editionId: edition.id,
      localDate: edition.localDate,
      platform: clientPlatform(),
    });
  }, [edition]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.eyebrow}>
        Lúdico
      </Text>
      <Text style={styles.title}>Un rato para pensar, cada día.</Text>
      <Text accessibilityLiveRegion="polite" style={styles.sessionStatus}>
        {guestStatus === "pending"
          ? "Preparando el guardado…"
          : guestStatus === "account"
            ? "Sesión iniciada. Tu progreso se sincronizará entre dispositivos."
            : guestStatus === "ready"
              ? "Tu progreso se guardará como invitado."
              : "Sin conexión: el progreso se guardará en este dispositivo."}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/account")}
        style={({ pressed }) => [styles.accountButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.accountButtonText}>Cuenta</Text>
      </Pressable>
      <PreviousResultsPanel />
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push("/archive")}
        style={({ pressed }) => [styles.accountButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.accountButtonText}>Archivo de 7 días</Text>
      </Pressable>
      <ConsentPanel active={guestStatus !== "pending"} />
      {edition === undefined ? (
        <ActivityIndicator accessibilityLabel="Cargando edición" color="#a83242" size="large" />
      ) : edition === null ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          La edición de hoy se está preparando. Vuelve en unos minutos.
        </Text>
      ) : (
        <View accessibilityLabel={`Retos del ${edition.localDate}`}>
          {edition.games.map((game) => (
            <View key={game.id} style={styles.card}>
              <Text accessibilityRole="header" style={styles.cardTitle}>
                {game.type === "quiz"
                  ? "Quiz diario"
                  : game.type === "true_false"
                    ? "Verdadero o falso"
                    : "Crucigrama diario"}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={game.status !== "active"}
                onPress={() =>
                  router.push({
                    pathname: game.type === "crossword" ? "/crossword/[gameId]" : "/quiz/[gameId]",
                    params: { gameId: game.id },
                  })
                }
                style={({ pressed }) => [
                  styles.button,
                  game.status !== "active" && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonText}>
                  {game.status === "active" ? "Jugar" : "Temporalmente no disponible"}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

async function loadEdition(signal: AbortSignal): Promise<PublicEdition | null> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
  try {
    const response = await fetch(`${apiUrl}/editions/today`, { signal });
    return response.ok ? ((await response.json()) as PublicEdition) : null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  accountButton: { alignSelf: "flex-start", minHeight: 44, paddingVertical: 10 },
  accountButtonText: { color: "#a83242", fontSize: 17, fontWeight: "700" },
  body: { color: "#17233c", fontSize: 18 },
  button: {
    alignItems: "center",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },
  card: {
    borderColor: "#17233c",
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
    marginTop: 16,
    padding: 20,
  },
  cardTitle: { color: "#17233c", fontSize: 22, fontWeight: "700" },
  container: {
    backgroundColor: "#fff9ef",
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
  },
  eyebrow: { color: "#a83242", fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  sessionStatus: { color: "#40506d", fontSize: 15, marginBottom: 8 },
  title: { color: "#17233c", fontSize: 36, fontWeight: "700", marginVertical: 12 },
});
