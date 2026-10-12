import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E configuration for auditable-voting.
 *
 * Theme toggle tests (e2e/theme-toggle.spec.ts) exercise the actual
 * ThemeToggle.tsx component and inline preload scripts through the
 * Vite dev server on port 5173.
 *
 * Uses the system-installed google-chrome-stable via channel: 'chrome'.
 * colorScheme is deliberately pinned to 'dark': the instance default is light,
 * so this proves the app ignores the OS preference (theme-toggle tests 6 + 8).
 */
// Other worktrees on this box grab port 5173; allow an override so an e2e run
// can never silently reuse a foreign dev server (reuseExistingServer: true).
const PORT = Number(process.env.AV_E2E_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    video: "on",
    screenshot: "only-on-failure",
    channel: "chrome",
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});