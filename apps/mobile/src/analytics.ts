import type { AnalyticsEventName } from "@ludico/contracts";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { getPlayerHeaders } from "./player-auth";

let enabled: boolean | undefined;
type Event = readonly [AnalyticsEventName, Readonly<Record<string, boolean | number | string>>];
const pending: Event[] = [];

export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    pending.length = 0;
    return;
  }
  for (const [name, properties] of pending.splice(0)) void send(name, properties);
}

export async function trackAnalytics(
  eventName: AnalyticsEventName,
  properties: Readonly<Record<string, boolean | number | string>>,
): Promise<void> {
  if (enabled === false) return;
  if (enabled === undefined) {
    pending.push([eventName, properties]);
    return;
  }
  await send(eventName, properties);
}

async function send(
  eventName: AnalyticsEventName,
  properties: Readonly<Record<string, boolean | number | string>>,
): Promise<void> {
  const controller = new AbortController();
  try {
    const player = await getPlayerHeaders(controller.signal);
    if (!player) return;
    await fetch(`${apiUrl()}/analytics/events`, {
      method: "POST",
      headers: {
        ...player,
        "Content-Type": "application/json",
        "idempotency-key": Crypto.randomUUID(),
        "x-client-platform": clientPlatform(),
      },
      body: JSON.stringify({
        events: [
          {
            eventId: Crypto.randomUUID(),
            eventName,
            occurredAt: new Date().toISOString(),
            properties,
            schemaVersion: 1,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch {
    // Optional telemetry never blocks the product.
  }
}

export function clientPlatform(): "android" | "ios" | "web" {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android";
}

export function scoreBucket(score: number): string {
  return score < 250 ? "0-249" : score < 500 ? "250-499" : score < 750 ? "500-749" : "750+";
}

export function durationBucket(durationMs: number): string {
  return durationMs < 60_000
    ? "<1m"
    : durationMs < 300_000
      ? "1-5m"
      : durationMs < 600_000
        ? "5-10m"
        : "10m+";
}

function apiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/v1";
}
