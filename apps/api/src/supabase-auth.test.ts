import { describe, expect, it, vi } from "vitest";
import {
  AuthProviderUnavailableError,
  verifySupabaseAccessToken,
  verifySupabaseAdminAccessToken,
} from "./supabase-auth.js";

const config = { publishableKey: "sb_publishable_test", url: "https://example.supabase.co/" };

describe("Supabase auth adapter", () => {
  it("accepts only a user confirmed by the auth server", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ email: "Persona@Example.com", id: "auth-user-1" }), {
        status: 200,
      }),
    );
    await expect(verifySupabaseAccessToken("valid-jwt", config, request)).resolves.toEqual({
      email: "Persona@Example.com",
      provider: "supabase",
      subject: "auth-user-1",
    });
    expect(request).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/user",
      expect.objectContaining({
        headers: { apikey: config.publishableKey, Authorization: "Bearer valid-jwt" },
      }),
    );

    request.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(verifySupabaseAccessToken("invalid", config, request)).resolves.toBeNull();
  });

  it("distinguishes provider outage from an invalid token", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(verifySupabaseAccessToken("token", config, request)).rejects.toBeInstanceOf(
      AuthProviderUnavailableError,
    );
  });

  it("trusts only server-managed admin metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          app_metadata: {
            admin_reauthenticated_at: "2026-08-01T10:00:00.000Z",
            admin_role: "editor",
          },
          id: "auth-admin-1",
          user_metadata: { admin_role: "superadmin" },
        }),
        { status: 200 },
      ),
    );
    await expect(verifySupabaseAdminAccessToken("admin-jwt", config, request)).resolves.toEqual({
      reauthenticatedAt: "2026-08-01T10:00:00.000Z",
      role: "editor",
      userId: "auth-admin-1",
    });

    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "auth-user-2", user_metadata: { admin_role: "superadmin" } }),
        { status: 200 },
      ),
    );
    await expect(verifySupabaseAdminAccessToken("user-jwt", config, request)).resolves.toBeNull();
  });
});
