// Verify each role subdomain renders its OWN UI (not the role-picker gateway),
// and that no asset request fails.
//
//   node infra/orangesync/verify-subdomains.mjs
//
// Resolves playwright from web/node_modules, so it works from a fresh checkout
// after `cd web && npm install && npx playwright install chromium`.
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../../web/package.json"));
const { chromium } = require("playwright");

const sites = [
  ["voter", "https://voter.orangesync.tech/"],
  ["coordinator", "https://coordinator.orangesync.tech/"],
  ["results", "https://results.orangesync.tech/"],
  ["dashboard", "https://dashboard.orangesync.tech/"],
];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const out = [];

for (const [label, url] of sites) {
  const consoleErrors = [];
  const failed = [];
  const onConsole = (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); };
  const onResponse = (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 110)}`); };
  page.on("console", onConsole);
  page.on("response", onResponse);

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const t = (s) => (s || "").replace(/\s+/g, " ").trim();
    const vis = (el) => el && el.offsetParent !== null;
    return {
      resolvedTo: location.pathname + location.search,
      title: document.title,
      heads: [...document.querySelectorAll("h1,h2,h3")].filter(vis).map((e) => t(e.textContent)).slice(0, 6),
      buttons: [...document.querySelectorAll("button")].filter(vis).map((e) => t(e.textContent)).filter(Boolean).slice(0, 12),
      bodyLen: document.body.innerText.length,
    };
  });

  page.off("console", onConsole);
  page.off("response", onResponse);
  out.push({ label, ...data, consoleErrors, failedRequests: failed });
}

await browser.close();
console.log(JSON.stringify(out, null, 1));
