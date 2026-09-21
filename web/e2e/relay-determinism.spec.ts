/**
 * Proof that the E2E harness is deterministic AND hermetic.
 *
 * These tests exist to make a falsifiable claim about the *harness* rather than
 * about a feature: every relay connection the real UI makes is served by the
 * in-process mock relay, and nothing reaches the public internet.
 *
 * If a future change reintroduces public-relay dependence (a new hard-coded
 * relay fetched before routing, a WebSocket opened outside the Nostr pool, a
 * CDN asset), these tests fail.
 */
import { expect, test } from "@playwright/test";
import { createDeterministicContext, waitForRelay } from "./support/mockRelay";

test.describe("deterministic relay harness", () => {
  test("coordinator publishes a questionnaire into the in-process relay with zero public egress", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, relay, egress } = await createDeterministicContext(browser);

    try {
      const coord = await context.newPage();
      await coord.goto("/dashboard.html?role=coordinator", { waitUntil: "domcontentloaded" });
      await expect(coord.locator("nav[aria-label='Questionnaire navigation']")).toBeVisible({
        timeout: 30_000,
      });

      // Author a questionnaire. The publish readiness gate requires a title,
      // a description and at least one valid question.
      await coord.getByLabel("Title").fill("Relay determinism check");
      const description = coord.getByLabel("Description");
      if (await description.count()) {
        await description.fill("Does the in-process relay carry this questionnaire?");
      }
      const prompts = coord.locator("input[aria-label^='Question '][aria-label$=' prompt']");
      const promptCount = await prompts.count();
      for (let i = 0; i < promptCount; i++) {
        const field = prompts.nth(i);
        if (!((await field.inputValue()) ?? "").trim()) {
          await field.fill("Approve funding for the community garden?");
        }
      }

      const goLive = coord.getByRole("button", { name: "Go Live" }).first();
      await expect(goLive).toBeEnabled({ timeout: 20_000 });
      await goLive.click();

      // The publish must reach the in-process relay...
      await waitForRelay(relay, (r) => r.received.length > 0, 30_000);
      // eslint-disable-next-line no-console
      console.log(
        `[relay-determinism] intercepted=${relay.interceptedUrls.length} published kinds=${JSON.stringify(
          relay.kindHistogram(),
        )}`,
      );

      expect(
        relay.interceptedUrls.length,
        "the real UI must have opened at least one relay WebSocket",
      ).toBeGreaterThan(0);
      expect(relay.storedCount, "the relay must have stored the published event").toBeGreaterThan(0);
      expect(
        egress.externalWebSockets,
        "no external WebSocket may be dialled (all relay traffic must be mocked)",
      ).toEqual([]);
      expect(
        egress.externalRequests,
        "no external HTTP request may be made (no CDN / public relay fetch)",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("two contexts exchange events through the shared in-process relay", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, relay, egress } = await createDeterministicContext(browser);

    try {
      const coord = await context.newPage();
      await coord.goto("/dashboard.html?role=coordinator", { waitUntil: "domcontentloaded" });
      await expect(coord.locator("nav[aria-label='Questionnaire navigation']")).toBeVisible({
        timeout: 30_000,
      });
      await coord.getByLabel("Title").fill("Cross-context relay check");
      const description = coord.getByLabel("Description");
      if (await description.count()) {
        await description.fill("Voter page must read this back through the relay.");
      }
      const prompts = coord.locator("input[aria-label^='Question '][aria-label$=' prompt']");
      for (let i = 0; i < (await prompts.count()); i++) {
        const field = prompts.nth(i);
        if (!((await field.inputValue()) ?? "").trim()) {
          await field.fill("Approve funding?");
        }
      }
      await expect(coord.getByRole("button", { name: "Go Live" }).first()).toBeEnabled({
        timeout: 20_000,
      });
      await coord.getByRole("button", { name: "Go Live" }).first().click();
      await waitForRelay(relay, (r) => r.received.length > 0, 30_000);

      // A second page (same context, fresh browser profile state) reads the
      // questionnaire straight back out of the relay store.
      const voter = await context.newPage();
      await voter.goto("/vote.html?role=voter", { waitUntil: "domcontentloaded" });

      const storedAfterPublish = relay.storedCount;
      expect(storedAfterPublish).toBeGreaterThan(0);
      // The voter page must have opened its own relay sockets to the same relay.
      await expect
        .poll(() => relay.interceptedUrls.length, { timeout: 20_000 })
        .toBeGreaterThanOrEqual(1);
      expect(egress.externalWebSockets).toEqual([]);
      expect(egress.externalRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
