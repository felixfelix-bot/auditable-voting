import { execSync } from "node:child_process";

/**
 * Resolve the GitHub Pages base URL for the e2e video spec.
 *
 * The Pages site for a `gh-pages` deployment lives at
 * `https://<owner>.github.io/<repo>/`, where <owner> is the repository
 * owner that OWNS the deployment (fork owners deploy their own fork's
 * Pages site; upstream deploys its own). Hard-coding one owner breaks
 * the moment the same spec runs against a different remote (e.g. the
 * fork PR run vs the merged upstream run).
 *
 * Resolution order:
 *   1. $E2E_PAGES_BASE_URL — explicit override (CI / local)
 *   2. git remote "origin" — derive `owner/repo` from the checkout
 *   3. Fallback — upstream repo (tidley/auditable-voting)
 */
export function resolvePagesBaseUrl(): string {
  const override = process.env.E2E_PAGES_BASE_URL;
  if (override) {
    return override.replace(/\/+$/, "");
  }

  try {
    const remote = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // Accept https://github.com/OWNER/REPO[.git] and git@github.com:OWNER/REPO[.git]
    const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (m) {
      const [, owner, repo] = m;
      if (owner && repo) {
        return `https://${owner}.github.io/${repo}`;
      }
    }
  } catch {
    // git remote unavailable — fall through to the default below.
  }

  return "https://tidley.github.io/auditable-voting";
}
