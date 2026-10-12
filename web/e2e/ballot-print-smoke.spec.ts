import { expect, test } from "@playwright/test";

/**
 * Smoke test for the paper-ballot print surface (PR #38).
 *
 * SCOPE — read before reviewing the video this records:
 * `PaperBallotPrint` is NOT reachable from the app's navigation on this branch.
 * The route that renders it arrives with the batch-portal work (F4), a separate
 * PR. So this test mounts the component through e2e/ballot-print-harness.html
 * rather than driving a user journey. It demonstrates precisely what #38
 * changes — the nsec masked on screen, reveal-on-demand, the serial row — and
 * makes no claim about how a resident reaches the screen.
 *
 * This is deliberately NOT called an end-to-end app flow. When F4 lands, this
 * should be re-pointed at the real route and this note removed.
 */
test("paper ballot print: nsec masked by default, reveal works, serial shown", async ({ page }) => {
  await page.goto("/e2e/ballot-print-harness.html");

  // The ballot renders with its title and id.
  await expect(page.getByText("Community Garden Budget")).toBeVisible();
  await expect(page.getByText("Ballot ID: review-harness-2024")).toBeVisible();

  // F3-2: the serial number is printed.
  await expect(page.locator(".ballot-serial")).toHaveText(/Serial:\s*SN-0042/);

  // The nsec row is masked: maskNsec() = first 8 chars + "…" + last 4, so the
  // rendered form is short (~17 chars) and can never be the 63-char key.
  const nsecValue = page.locator(".ballot-key-value").first();
  const maskedText = (await nsecValue.textContent()) ?? "";
  expect(maskedText).toMatch(/^nsec1[a-z0-9]{3}…[a-z0-9]{4}$/);
  expect(maskedText.length).toBeLessThan(20);

  // F3-1: the raw key is NOT anywhere in the document before revealing.
  await expect(page.locator("body")).not.toContainText(/nsec1[a-z0-9]{40,}/);

  // Hold the masked state in the video so it is legible.
  await page.waitForTimeout(1200);

  // Reveal on demand: the full key appears only after the explicit click.
  await page.getByRole("button", { name: /reveal/i }).click();
  await expect(page.locator(".ballot-key-value").first()).toHaveText(/^nsec1[a-z0-9]{50,}/);
  await expect(page.getByRole("button", { name: /shown/i })).toBeVisible();

  // The npub and invite code are shown as before (no regression).
  await expect(page.getByText("GARDEN-7F3A")).toBeVisible();

  // Hold the revealed state so the video ends on a readable frame.
  await page.waitForTimeout(1500);
});
