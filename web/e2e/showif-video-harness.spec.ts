// Video harness for #37's feature: conditional follow-up questions (showIf).
// Drives the REAL coordinator build UI with the same selectors the component
// tests use (QuestionnaireCoordinatorPanel.conditional.test.tsx):
// Add Question -> "Question N visibility" -> conditional -> depends-on ->
// required-answer radios. Shows the Show-if configuration appearing live.
import { test, expect } from "@playwright/test";

test("coordinator configures a conditional follow-up question (showIf)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard.html?role=coordinator");
  const cont = page.getByRole("button", { name: "Continue as Coordinator" });
  if (await cont.isVisible().catch(() => false)) { await cont.click(); await page.waitForTimeout(1500); }

  // Editor tab
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.waitForTimeout(1000);

  // Dismiss the demo tour if it appears
  const startDemo = page.getByRole("button", { name: "Start demo" });
  if (await startDemo.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // Title
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Dependants survey (showIf demo)");
  await page.waitForTimeout(400);

  // Q1 prompt (default yes_no)
  const q1prompt = page.getByLabel("Question 1 prompt", { exact: false });
  await q1prompt.fill("Do you have dependants?");
  await page.waitForTimeout(400);

  // Add a second question and make it conditional on Q1 = Yes
  await page.getByRole("button", { name: "Add Question" }).click();
  await page.waitForTimeout(500);
  await page.getByLabel("Question 2 prompt", { exact: false }).fill("How many dependants?");
  await page.waitForTimeout(400);

  const vis = page.getByLabel("Question 2 visibility");
  await vis.scrollIntoViewIfNeeded();
  await vis.selectOption("conditional");
  await page.waitForTimeout(500);

  const dep = page.getByLabel("Question 2 depends on");
  await dep.selectOption({ index: 0 }); // first earlier question (Q1)
  await page.waitForTimeout(500);

  // Q1 is yes_no -> Yes/No radios appear
  const yes = page.getByLabel("Question 2 required answer Yes");
  await yes.scrollIntoViewIfNeeded();
  await yes.check();
  await page.waitForTimeout(600);

  // Show the final configured state
  await expect(page.getByLabel("Question 2 visibility")).toHaveValue("conditional");
  await page.waitForTimeout(1500);
});
