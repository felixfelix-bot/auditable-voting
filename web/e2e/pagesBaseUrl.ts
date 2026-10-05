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
 *   2. git remote "upstream" — if present (owner/repo of the authoritative repo)
 *   3. git remote "origin" — derive `owner/repo` from the checkout
 *   4. Fallback — upstream repo (tidley/auditable-voting)
 *
 * Preferring "upstream" over "origin" matters: contributors commonly clone the
 * fork with `origin` = their fork, so deriving from `origin` alone would point
 * the video spec at `felixfelix-bot.github.io` (the fork's Pages). The site
 * that matters is the one owned by the authoritative repo.
 */
export function resolvePagesBaseUrl(): string {
  const override = process.env.E2E_PAGES_BASE_URL;
  if (override) {
    return override.replace(/\/+$/, "");
  }

  for (const remote of ["upstream", "origin"]) {
    try {
      const url = execSync(`git config --get remote.${remote}.url`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      // Accept https://github.com/OWNER/REPO[.git] and git@github.com:OWNER/REPO[.git]
      const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (m) {
        const [, owner, repo] = m;
        if (owner && repo) {
          return `https://${owner}.github.io/${repo}`;
        }
      }
    } catch {
      // remote not configured — fall through to the next candidate.
    }
  }

  return "https://tidley.github.io/auditable-voting";
}
