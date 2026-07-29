import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  clearGuestSessionCredential,
  getGuestSessionCredential,
  getStoredGuestSessionCredential,
} from "./guest-session";

const authStorageKey = "ludico.auth.v1";
let client: SupabaseClient | null | undefined;

export type PlayerHeaders = { Authorization: string } | { "x-guest-token": string };

export function getAuthClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: {
            autoRefreshToken: true,
            detectSessionInUrl: false,
            persistSession: true,
            storage: {
              getItem: readAuthStorage,
              removeItem: removeAuthStorage,
              setItem: writeAuthStorage,
            },
          },
        })
      : null;
  return client;
}

export async function getPlayerHeaders(signal: AbortSignal): Promise<PlayerHeaders | null> {
  const storedGuest = await getStoredGuestSessionCredential();
  if (storedGuest) return { "x-guest-token": storedGuest.token };
  const session = (await getAuthClient()?.auth.getSession())?.data.session;
  if (session) return { Authorization: `Bearer ${session.access_token}` };
  const guest = await getGuestSessionCredential(signal);
  return guest ? { "x-guest-token": guest.token } : null;
}

export async function migrateGuestSession(accessToken: string, signal: AbortSignal): Promise<void> {
  const guest = await getGuestSessionCredential(signal);
  if (!guest) throw new Error("guest");
  const response = await fetch(`${apiUrl()}/auth/migrate-guest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "idempotency-key": Crypto.randomUUID(),
      "x-guest-token": guest.token,
    },
    signal,
  });
  if (!response.ok) throw new Error("migration");
  await clearGuestSessionCredential();
}

async function readAuthStorage(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(`${authStorageKey}.${key}`);
}

async function writeAuthStorage(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(`${authStorageKey}.${key}`, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function removeAuthStorage(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(`${authStorageKey}.${key}`);
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}
