"use client";

import type { AnalyticsEventName } from "@ludico/contracts";

const enabledKey = "ludico.analytics.enabled.v1";
type Event = readonly [AnalyticsEventName, Readonly<Record<string, boolean | number | string>>];
const pending: Event[] = [];

export function setAnalyticsEnabled(enabled: boolean): void {
  sessionStorage.setItem(enabledKey, String(enabled));
  if (!enabled) {
    pending.length = 0;
    return;
  }
  for (const [name, properties] of pending.splice(0)) void send(name, properties);
}

export async function trackAnalytics(
  eventName: AnalyticsEventName,
  properties: Readonly<Record<string, boolean | number | string>>,
): Promise<void> {
  const enabled = sessionStorage.getItem(enabledKey);
  if (enabled === "false") return;
  if (enabled !== "true") {
    pending.push([eventName, properties]);
    return;
  }
  await send(eventName, properties);
}

async function send(
  eventName: AnalyticsEventName,
  properties: Readonly<Record<string, boolean | number | string>>,
): Promise<void> {
  try {
    await fetch("/api/player/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            eventId: crypto.randomUUID(),
            eventName,
            occurredAt: new Date().toISOString(),
            properties,
            schemaVersion: 1,
          },
        ],
      }),
    });
  } catch {
    // Optional telemetry never blocks the product.
  }
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
