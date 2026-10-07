import { defineConfig } from "@playwright/test";

/**
 * Minimal Playwright config for running the e2e specs against an ALREADY
 * DEPLOYED build (no webServer, no dev server). Used with E2E_AV_BASE_URL.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { screenshot: "only-on-failure" },
});
