import { describe, expect, it, vi } from "vitest";
import { ExpoPushProvider } from "./notification-jobs.js";

const message = {
  body: "Cuerpo",
  deepLink: "/",
  title: "Título",
  token: `ExpoPushToken[${"a".repeat(32)}]`,
};

describe("Expo push provider", () => {
  it("sends only the expected notification fields", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "ticket-1", status: "ok" } }), {
        status: 200,
      }),
    );
    const provider = new ExpoPushProvider("access-token", request);

    await expect(provider.send(message)).resolves.toEqual({
      providerMessageId: "ticket-1",
      status: "sent",
    });
    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      body: "Cuerpo",
      channelId: "daily",
      data: { deepLink: "/" },
      sound: "default",
      title: "Título",
      to: message.token,
    });
    expect(init.headers).toMatchObject({ Authorization: "Bearer access-token" });
  });

  it("retries transient failures and deactivates invalid devices", async () => {
    const limited = new ExpoPushProvider(
      undefined,
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );
    await expect(limited.send(message)).resolves.toEqual({
      errorCode: "HTTP_429",
      status: "retry",
    });

    const invalid = new ExpoPushProvider(
      undefined,
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { details: { error: "DeviceNotRegistered" }, status: "error" },
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(invalid.send(message)).resolves.toEqual({
      deactivateEndpoint: true,
      errorCode: "DeviceNotRegistered",
      status: "failed",
    });
  });
});
