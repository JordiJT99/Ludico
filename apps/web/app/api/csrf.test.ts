import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rejectCrossSiteMutation } from "./csrf.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(origin: string) {
  return new NextRequest("http://127.0.0.1:3012/api/guest-session", {
    headers: {
      origin,
      "x-forwarded-host": "example.trycloudflare.com",
      "x-forwarded-proto": "https",
    },
    method: "POST",
  });
}

describe("CSRF origin validation", () => {
  it("allows the active reverse-proxy origin only during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PUBLIC_WEB_URL", "http://localhost:3000");

    expect(rejectCrossSiteMutation(request("https://example.trycloudflare.com"))).toBeNull();
  });

  it("keeps production restricted to its configured origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_WEB_URL", "https://ludico.example");

    expect(rejectCrossSiteMutation(request("https://example.trycloudflare.com"))?.status).toBe(403);
  });
});
