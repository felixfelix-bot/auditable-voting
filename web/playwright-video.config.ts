import { defineConfig } from "@playwright/test";
import { resolvePagesBaseUrl } from "./e2e/pagesBaseUrl";

/**
 * Playwright configuration for recording the auditable-voting E2E video
 * against the live GitHub Pages deployment.
 *
 * - NO webServer — the site is hosted externally (Pages base derived from
 *   the git origin remote so fork runs hit fork Pages, upstream hits
 *   https://tidley.github.io/auditable-voting; override with
 *   $E2E_PAGES_BASE_URL).
 * - video: "on" captures a WebM per browser context
 * - channel: "chrome" uses the system google-chrome-stable for realistic
 *   rendering and reliable WebCodecs/wasm.
 * - viewport 1400x900 for a wide, readable frame.
 */
const pagesBaseUrl = resolvePagesBaseUrl();
const pagesOrigin = new URL(pagesBaseUrl).origin;

export default defineConfig({
  testDir: ".",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: pagesOrigin,
    viewport: { width: 1400, height: 900 },
    video: "on",
    screenshot: "on",
    channel: "chrome",
    colorScheme: "light",
    trace: "off",
    actionTimeout: 30_000,
  },
  // NO webServer — target is the hosted GitHub Pages site.
});
