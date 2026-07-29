import type { GuestSessionCredential } from "@ludico/contracts";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const storageKey = "ludico.guest-session.v1";

export async function clearGuestSessionCredential(): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(storageKey);
    return;
  }
  await SecureStore.deleteItemAsync(storageKey);
}

export async function ensureGuestSession(signal: AbortSignal): Promise<"ready" | "local-only"> {
  return (await getGuestSessionCredential(signal)) ? "ready" : "local-only";
}

export async function getGuestSessionCredential(
  signal: AbortSignal,
): Promise<GuestSessionCredential | null> {
  const stored = await getStoredGuestSessionCredential();
  if (stored) return stored;

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
  try {
    const response = await fetch(`${apiUrl}/guest-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin: Platform.OS === "ios" ? "ios" : "android" }),
      signal,
    });
    if (!response.ok) return null;
    const credential = (await response.json()) as GuestSessionCredential;
    if (!isCredential(credential)) return null;
    await writeCredential(credential);
    return credential;
  } catch {
    return null;
  }
}

export async function getStoredGuestSessionCredential(): Promise<GuestSessionCredential | null> {
  const stored = await readCredential();
  return stored && Date.parse(stored.expiresAt) > Date.now() ? stored : null;
}

async function readCredential(): Promise<GuestSessionCredential | null> {
  const value =
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(storageKey)
      : await SecureStore.getItemAsync(storageKey);
  if (!value) return null;
  try {
    const credential = JSON.parse(value) as GuestSessionCredential;
    return isCredential(credential) ? credential : null;
  } catch {
    return null;
  }
}

async function writeCredential(credential: GuestSessionCredential): Promise<void> {
  const value = JSON.stringify(credential);
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(storageKey, value);
    return;
  }
  await SecureStore.setItemAsync(storageKey, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

function isCredential(value: GuestSessionCredential): boolean {
  return (
    typeof value.guestSessionId === "string" &&
    typeof value.token === "string" &&
    value.token.length >= 43 &&
    !Number.isNaN(Date.parse(value.expiresAt))
  );
}
