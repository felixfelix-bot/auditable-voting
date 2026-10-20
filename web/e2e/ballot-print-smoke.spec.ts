import { expect, test } from "@playwright/test";

// Component integration harness: real coordinator/print UI and production CSS,
// with admission persistence stubbed. This is not a relay admission E2E test.
test("paper ballots remain visible through the React root in print media", async ({ page }) => {
  await page.goto("/e2e/ballot-print-harness.html");
  await page.getByLabel("Master-list numbers", { exact: true }).fill("ML-001\nML-002");
  await page.getByLabel("Code expiry", { exact: true }).fill("2030-01-01T12:30");
  await page.getByRole("button", { name: "Generate printable codes" }).click();
  const ballots = page.locator(".ballot-print");
  await expect(ballots).toHaveCount(2);
  await expect(ballots.first().locator("code")).toHaveText(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/);
  await expect(ballots.first()).toContainText("includes all of: Raised beds; Tool library. Other selections are allowed.");
  await expect(ballots.first()).toContainText("Otherwise leave blank.");
  await expect(page.locator("body")).not.toContainText(/nsec|npub|Serial:/);

  await page.emulateMedia({ media: "print" });
  // These checks fail if the real stylesheet hides any ancestor of the ballot.
  await expect(ballots.first()).toBeVisible();
  await expect(ballots.last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate printable codes" })).toBeHidden();
  await expect(page.getByLabel("Master-list numbers", { exact: true })).toBeHidden();
  await expect(page.locator(".harness-navigation")).toBeHidden();
  expect(await ballots.first().evaluate(el => getComputedStyle(el).fontFamily)).toContain("Courier");
  expect(await ballots.first().evaluate(el => getComputedStyle(el).breakAfter)).toBe("page");
  await page.screenshot({ path: test.info().outputPath("paper-ballots-print.png"), fullPage: true });
  await page.pdf({ path: test.info().outputPath("paper-ballots.pdf"), format: "A4" });
});
