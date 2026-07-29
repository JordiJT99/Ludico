import { isShareResult } from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Pressable, Share, StyleSheet, Text } from "react-native";
import { clientPlatform, trackAnalytics } from "./analytics";
import { getPlayerHeaders } from "./player-auth";

export function ShareButton({ attemptId }: Readonly<{ attemptId: string }>) {
  const [status, setStatus] = useState<string>();

  async function share() {
    const controller = new AbortController();
    try {
      const player = await getPlayerHeaders(controller.signal);
      if (!player) throw new Error("session");
      const response = await fetch(`${apiUrl()}/share-results`, {
        method: "POST",
        headers: {
          ...player,
          "Content-Type": "application/json",
          "idempotency-key": Crypto.randomUUID(),
        },
        body: JSON.stringify({ attemptId }),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isShareResult(result)) throw new Error("share");
      const shared = await Share.share({
        message: `${result.text}\n${result.url}`,
        title: "Mi resultado en Lúdico",
      });
      void trackAnalytics("ShareCompleted", {
        attemptId,
        channelCategory: "native",
        platform: clientPlatform(),
        result: shared.action === Share.sharedAction ? "success" : "dismissed",
      });
      setStatus("Resultado compartido.");
    } catch {
      setStatus("No se pudo compartir el resultado.");
    }
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => void share()} style={styles.button}>
        <Text style={styles.buttonText}>Compartir resultado</Text>
      </Pressable>
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
    </>
  );
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  buttonText: { color: "#fff9ef", fontSize: 18, fontWeight: "700" },
  status: { color: "#40506d", fontSize: 16 },
});
