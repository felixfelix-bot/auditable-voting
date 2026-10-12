import { test, expect } from "@playwright/test";

/**
 * The role picker must keep each icon proportionate to its label in EVERY
 * locale.
 *
 * `.av-ui-icon` is a global hard-coded 17px (`styles.css`). Scripts whose
 * glyphs are taller than Latin at the same font-size (Tamil measures a 17.37px
 * line box against the same 14.72px font-size) produce a label line box that
 * EXCEEDS the icon box, so the label visually dominates the icon.
 *
 * Invariant asserted: the icon box strictly contains the label line box.
 *
 * Runs against the local dev server by default. Point E2E_AV_BASE_URL at a
 * deployed build to check a real artifact:
 *   E2E_AV_BASE_URL=https://dashboard.example.tech npx playwright test  *     e2e/role-picker-icon-scaling.spec.ts
 */

const BASE = process.env.E2E_AV_BASE_URL || "";
const LOCALES = ["en", "fr", "ta"] as const;

for (const lang of LOCALES) {
  test(`role picker icon encompasses the ${lang} label`, async ({ page }) => {
    await page.goto(`${BASE}/?lang=${lang}`);

    const buttons = page.locator(".simple-role-switch-login .simple-role-switch-button");
    await expect(buttons.first()).toBeVisible();
    const count = await buttons.count();
    expect(count, "the role picker should offer at least one role").toBeGreaterThan(0);

    const measured = await buttons.evaluateAll((els) =>
      els.map((el) => {
        const svg = el.querySelector("svg");
        const leaves = [...el.querySelectorAll("*")].filter(
          (e) => e.children.length === 0 && e.textContent && e.textContent.trim(),
        );
        const labelEl = leaves[leaves.length - 1] || null;
        const cs = labelEl ? getComputedStyle(labelEl) : null;
        const lineHeight = cs
          ? parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
          : 0;
        return {
          label: labelEl ? labelEl.textContent.trim() : "",
          iconHeight: svg ? svg.getBoundingClientRect().height : 0,
          lineHeight,
        };
      }),
    );

    expect(measured.length).toBeGreaterThan(0);
    for (const m of measured) {
      expect(m.iconHeight, `"${m.label}" should not have a zero-size icon`).toBeGreaterThan(0);
      expect(
        m.iconHeight,
        `icon (${m.iconHeight.toFixed(2)}px) must encompass the "${m.label}" label line box (${m.lineHeight.toFixed(2)}px) in locale "${lang}"`,
      ).toBeGreaterThan(m.lineHeight);
    }
  });
}
