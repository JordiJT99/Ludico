import { currentConsentPolicyVersion, isConsentState, type ConsentState } from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { setAnalyticsEnabled, trackAnalytics } from "./analytics";
import { getPlayerHeaders, type PlayerHeaders } from "./player-auth";

type Choice = Pick<ConsentState, "ads" | "analytics">;
let appOpenedSent = false;

export function ConsentPanel({ active }: Readonly<{ active: boolean }>) {
  const [consent, setConsent] = useState<ConsentState>();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<Choice>({ ads: false, analytics: false });
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void loadConsent(controller.signal).then((current) => {
      if (!current) return;
      setConsent(current);
      setChoice({ ads: current.ads, analytics: current.analytics });
      setAnalyticsEnabled(current.analytics);
      if (current.recordedAt === null || current.policyVersion !== currentConsentPolicyVersion) {
        setEditing(true);
      } else if (current.analytics) {
        void sendAppOpened(controller.signal);
      }
    });
    return () => controller.abort();
  }, [active]);

  async function save(next: Choice) {
    const controller = new AbortController();
    setPending(true);
    setMessage("");
    try {
      const headers = await getPlayerHeaders(controller.signal);
      if (!headers) throw new Error("player");
      const response = await fetch(`${apiUrl()}/consents`, {
        method: "POST",
        headers: commandHeaders(headers),
        body: JSON.stringify({ ...next, policyVersion: currentConsentPolicyVersion }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok || !isConsentState(body)) throw new Error("consent");
      setConsent(body);
      setChoice({ ads: body.ads, analytics: body.analytics });
      setAnalyticsEnabled(body.analytics);
      setEditing(false);
      setMessage("Preferencias de privacidad guardadas.");
      if (body.analytics) await sendAppOpened(controller.signal);
    } catch {
      setMessage("No se pudieron guardar. Inténtalo cuando tengas conexión.");
    }
    setPending(false);
  }

  const showTestAd = consent?.ads === true && process.env.EXPO_PUBLIC_ADS_MODE === "test";
  return (
    <View>
      <View accessibilityLabel="Espacio publicitario" style={styles.adSlot}>
        {showTestAd ? <Text style={styles.adText}>Anuncio de prueba</Text> : null}
      </View>
      {editing ? (
        <View accessibilityLabel="Preferencias de privacidad" style={styles.panel}>
          <Text accessibilityRole="header" style={styles.heading}>
            Tu privacidad
          </Text>
          <Text style={styles.copy}>
            Las funciones necesarias guardan tu partida. Elige por separado medición anónima y
            anuncios de prueba.
          </Text>
          <ChoiceRow disabled label="Funciones necesarias" value />
          <ChoiceRow
            label="Analítica sin respuestas ni texto libre"
            onValueChange={(analytics) => setChoice({ ...choice, analytics })}
            value={choice.analytics}
          />
          <ChoiceRow
            label="Anuncios de prueba"
            onValueChange={(ads) => setChoice({ ...choice, ads })}
            value={choice.ads}
          />
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void save({ ads: false, analytics: false })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Solo necesarias</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void save(choice)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Guardar selección</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void save({ ads: true, analytics: true })}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Aceptar opcionales</Text>
          </Pressable>
        </View>
      ) : consent ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditing(true)}
          style={styles.privacyButton}
        >
          <Text style={styles.privacyButtonText}>Privacidad</Text>
        </Pressable>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.copy}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function ChoiceRow({
  disabled = false,
  label,
  onValueChange,
  value,
}: Readonly<{
  disabled?: boolean;
  label: string;
  onValueChange?: (value: boolean) => void;
  value: boolean;
}>) {
  return (
    <View style={styles.choice}>
      <Switch disabled={disabled} onValueChange={onValueChange} value={value} />
      <Text style={styles.choiceText}>{label}</Text>
    </View>
  );
}

async function loadConsent(signal: AbortSignal): Promise<ConsentState | null> {
  try {
    const headers = await getPlayerHeaders(signal);
    if (!headers) return null;
    const response = await fetch(`${apiUrl()}/consents/current`, { headers, signal });
    const body: unknown = await response.json();
    return response.ok && isConsentState(body) ? body : null;
  } catch {
    return null;
  }
}

async function sendAppOpened(signal: AbortSignal): Promise<void> {
  if (appOpenedSent) return;
  if (signal.aborted) return;
  await trackAnalytics("AppOpened", {
    connectivity: "unknown",
    platform: clientPlatform(),
    source: "navigation",
  });
  appOpenedSent = true;
}

function commandHeaders(player: PlayerHeaders) {
  return {
    ...player,
    "Content-Type": "application/json",
    "idempotency-key": Crypto.randomUUID(),
    "x-client-platform": clientPlatform(),
  };
}

function clientPlatform(): "android" | "ios" | "web" {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android";
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}

const styles = StyleSheet.create({
  adSlot: { alignItems: "center", justifyContent: "center", minHeight: 64 },
  adText: { borderColor: "#71809c", borderStyle: "dashed", borderWidth: 2, padding: 12 },
  button: {
    alignItems: "center",
    backgroundColor: "#17233c",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  buttonText: { color: "#fff9ef", fontSize: 16, fontWeight: "700" },
  choice: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 44 },
  choiceText: { color: "#17233c", flex: 1, fontSize: 16 },
  copy: { color: "#40506d", fontSize: 15 },
  heading: { color: "#17233c", fontSize: 22, fontWeight: "700" },
  panel: {
    borderColor: "#71809c",
    borderRadius: 12,
    borderWidth: 2,
    gap: 10,
    marginTop: 8,
    padding: 16,
  },
  privacyButton: { alignSelf: "flex-start", minHeight: 44, paddingVertical: 10 },
  privacyButtonText: { color: "#a83242", fontSize: 17, fontWeight: "700" },
});
