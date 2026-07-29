import {
  claimDueNotificationDeliveries,
  completeNotificationDelivery,
  decryptPushToken,
  scheduleEligibleNotifications,
  type SqlClient,
} from "@ludico/database";
import type { NotificationUseCase } from "@ludico/domain";

export interface PushMessage {
  readonly body: string;
  readonly deepLink: string;
  readonly title: string;
  readonly token: string;
}

export type PushResult =
  | { readonly status: "sent"; readonly providerMessageId: string }
  | { readonly status: "retry"; readonly errorCode: string }
  | {
      readonly status: "failed";
      readonly errorCode: string;
      readonly deactivateEndpoint?: boolean;
    };

export interface PushProvider {
  send(message: PushMessage): Promise<PushResult>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class ExpoPushProvider implements PushProvider {
  constructor(
    private readonly accessToken?: string,
    private readonly request: FetchLike = fetch,
  ) {}

  async send(message: PushMessage): Promise<PushResult> {
    let response: Response;
    try {
      response = await this.request("https://exp.host/--/api/v2/push/send", {
        body: JSON.stringify({
          body: message.body,
          channelId: "daily",
          data: { deepLink: message.deepLink },
          sound: "default",
          title: message.title,
          to: message.token,
        }),
        headers: {
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    } catch {
      return { errorCode: "NETWORK_ERROR", status: "retry" };
    }
    if (response.status === 429 || response.status >= 500) {
      return { errorCode: `HTTP_${response.status}`, status: "retry" };
    }
    if (!response.ok) return { errorCode: `HTTP_${response.status}`, status: "failed" };
    const payload: unknown = await response.json().catch(() => null);
    const ticket = readExpoTicket(payload);
    if (!ticket) return { errorCode: "INVALID_RESPONSE", status: "retry" };
    if (ticket.status === "ok") {
      return { providerMessageId: ticket.id, status: "sent" };
    }
    if (ticket.error === "DeviceNotRegistered") {
      return { deactivateEndpoint: true, errorCode: ticket.error, status: "failed" };
    }
    return ticket.error === "MessageRateExceeded"
      ? { errorCode: ticket.error, status: "retry" }
      : { errorCode: ticket.error, status: "failed" };
  }
}

export const fakePushProvider: PushProvider = {
  async send() {
    return { providerMessageId: crypto.randomUUID(), status: "sent" };
  },
};

export async function runNotificationScheduler(client: SqlClient, now: Date) {
  return scheduleEligibleNotifications(client, now);
}

export async function runNotificationDeliveryBatch(
  client: SqlClient,
  provider: PushProvider,
  encryptionKey: string,
  now: Date,
): Promise<{ failed: number; retried: number; sent: number }> {
  const deliveries = await claimDueNotificationDeliveries(client, now);
  const totals = { failed: 0, retried: 0, sent: 0 };
  for (const delivery of deliveries) {
    let result: PushResult;
    try {
      result = await provider.send({
        ...notificationCopy(delivery.useCase),
        deepLink: delivery.deepLink,
        token: decryptPushToken(delivery.tokenCiphertext, encryptionKey),
      });
    } catch {
      result = {
        deactivateEndpoint: true,
        errorCode: "TOKEN_DECRYPTION_FAILED",
        status: "failed",
      };
    }
    await completeNotificationDelivery(client, delivery.id, result, now);
    if (result.status === "sent") totals.sent += 1;
    else if (result.status === "retry") totals.retried += 1;
    else totals.failed += 1;
  }
  return totals;
}

function notificationCopy(useCase: NotificationUseCase): { body: string; title: string } {
  if (useCase === "daily_digest") {
    return {
      body: "Juega la edición de hoy y consulta la solución anterior.",
      title: "Tu reto diario ya está listo",
    };
  }
  return useCase === "edition_available"
    ? { body: "La nueva edición de Lúdico te espera.", title: "Tu reto diario ya está listo" }
    : { body: "Consulta la solución del reto de ayer.", title: "Ya puedes ver la solución" };
}

function readExpoTicket(
  value: unknown,
): { error: string; status: "error" } | { id: string; status: "ok" } | null {
  if (!value || typeof value !== "object" || !("data" in value)) return null;
  const data = value.data;
  if (!data || typeof data !== "object" || !("status" in data)) return null;
  if (data.status === "ok" && "id" in data && typeof data.id === "string") {
    return { id: data.id, status: "ok" };
  }
  if (data.status !== "error") return null;
  const error =
    "details" in data &&
    data.details &&
    typeof data.details === "object" &&
    "error" in data.details &&
    typeof data.details.error === "string"
      ? data.details.error
      : "PROVIDER_ERROR";
  return { error, status: "error" };
}
