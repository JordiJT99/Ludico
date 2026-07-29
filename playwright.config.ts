import { defineConfig, devices } from "@playwright/test";

const e2eApiUrl = "http://127.0.0.1:4100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node scripts/e2e-fake-api.mjs",
      env: { E2E_API_PORT: "4100" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: `${e2eApiUrl}/v1/editions/today`,
    },
    {
      command: "pnpm --dir apps/web exec next start -p 3100",
      env: {
        PUBLIC_WEB_URL: "http://127.0.0.1:3100",
        PUBLIC_API_URL: `${e2eApiUrl}/v1`,
        SUPABASE_PUBLISHABLE_KEY: "e2e",
        SUPABASE_URL: e2eApiUrl,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: "http://127.0.0.1:3100",
    },
  ],
});
