import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";
import { EnvironmentSelectionSchema } from "#shared/model/route-contract.ts";
import {
  api,
  expectAccessible,
  expectNoHorizontalOverflow,
  expectNoViolations,
} from "./helpers.ts";

// Served by e2e/model-server.ts with the model specs: every Arcade release
// records prose and JSON receipts on its sync and readback steps, and the
// quarantined beta deploy stopped with its sync step still running.

/** The promotion arcade/prod accepted last. */
async function accepted(page: Page) {
  const view = await api(
    page,
    `/api/v1/environments/${encodeURIComponent("arcade/prod")}/selection`,
    EnvironmentSelectionSchema,
  );
  return z.string().parse(view.acceptedDeploymentId);
}

/** The beta deploy the harness left quarantined with a recovery intent. */
async function quarantined(page: Page) {
  const { items } = await api(
    page,
    `/api/v1/deployments?environmentId=${encodeURIComponent("arcade/beta")}`,
    DeploymentPageSchema,
  );
  const deployment = items.find((item) => item.recoveryRequired);
  if (deployment === undefined) throw new Error("seeded quarantine");
  return deployment.id;
}

/** One step of the timeline, by its stage key. */
function step(steps: Locator, key: string) {
  return steps
    .locator("ol.step-timeline > li")
    .filter({ has: steps.page().getByText(key, { exact: true }) });
}

test("a settled step folds its evidence, which opens as labelled facts under that step", async ({
  page,
}) => {
  await page.goto(`/deployments/${await accepted(page)}`);
  const steps = page.getByRole("region", { name: "Steps" });
  const sync = step(steps, "step-sync");
  await expect(sync).toContainText("succeeded");
  await expect(sync).toContainText("sync completed");
  // Nothing on the page is raw JSON, with every disclosure still closed.
  const main = page.getByRole("main");
  await expect(main).not.toContainText('{"adapter"');
  await expect(main.getByText("Application", { exact: true })).toBeHidden();
  // The step says how much it recorded and shows it on request.
  const evidence = sync.locator(":scope > details");
  await expect(evidence).not.toHaveAttribute("open");
  await expect(evidence.locator(":scope > summary")).toHaveText(
    /Evidence\s*2/u,
  );
  await evidence.locator(":scope > summary").click();
  await expect(
    sync.getByText("Application is owned by this deployment"),
  ).toBeVisible();
  const receipt = sync.getByRole("listitem").filter({ hasText: "kubernetes" });
  for (const [label, value] of [
    ["Step", "sync"],
    ["Application", "arcade"],
    ["Resources", "synced 12 · pruned 0"],
  ] as const) {
    const fact = receipt.locator("dl.facts > div").filter({
      has: page.getByText(label, { exact: true }),
    });
    await expect(fact.locator("dd")).toHaveText(value);
  }
  // A long id is short on screen and whole to a screen reader.
  await expect(
    receipt.locator("dl.facts > div", { hasText: "Revision" }).locator("abbr"),
  ).toHaveAttribute("title", "a".repeat(40));
  // A nested value stays formatted JSON behind its own disclosure.
  const nested = receipt.getByText('"phase": "Succeeded"');
  await expect(nested).toBeHidden();
  await receipt.getByText("Operation", { exact: true }).click();
  await expect(nested).toBeVisible();
  await expect(main).not.toContainText('{"adapter"');
  // Evidence of another step is under that step, not this one.
  await expect(sync).not.toContainText("Healthy");
  const readback = step(steps, "step-readback");
  await readback.locator(":scope > details > summary").click();
  await expect(readback.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(step(steps, "step-render")).toContainText("no evidence");
  await expectNoHorizontalOverflow(page);
});

test("evidence no step recorded is grouped by what recorded it", async ({
  page,
}) => {
  await page.goto(`/deployments/${await accepted(page)}`);
  const evidence = page.getByRole("region", { name: "Evidence", exact: true });
  await expect(
    evidence.getByRole("heading", { name: "Reported with the result" }),
  ).toBeVisible();
  await expect(evidence).toContainText("acceptance checks passed");
  await expect(
    evidence.getByRole("heading", { name: "Monitor" }),
  ).toBeVisible();
  // The alarm's receipt names its alert as a fact.
  await expect(
    evidence.locator("dl.facts > div", { hasText: "Alertname" }).locator("dd"),
  ).toHaveText("ArcadeErrorBudgetBurn");
  await expect(evidence).toContainText(
    "3 more are shown under the steps that recorded them.",
  );
  await expect(evidence).not.toContainText("kubernetes");
});

test("a step that has not settled shows its evidence without being asked", async ({
  page,
}) => {
  await page.goto(`/deployments/${await quarantined(page)}`);
  const sync = step(page.getByRole("region", { name: "Steps" }), "step-sync");
  await expect(sync).toContainText("running");
  await expect(sync.locator(":scope > details")).toHaveAttribute("open");
  await expect(
    sync.locator("dl.facts > div", { hasText: "Phase" }).locator("dd"),
  ).toBeVisible();
  await expect(
    sync.locator("dl.facts > div", { hasText: "Phase" }).locator("dd"),
  ).toHaveText("Running");
  await expectNoHorizontalOverflow(page);
});

test("the frozen inputs stay folded until they are opened", async ({
  page,
}) => {
  await page.goto(`/deployments/${await accepted(page)}`);
  const inputs = page.getByRole("region", { name: "Frozen inputs" });
  await expect(inputs).toContainText("arcade/3");
  const pinned = inputs.getByText('"definition"').first();
  await expect(pinned).toBeHidden();
  await inputs.getByText("Pinned pipeline and configuration").click();
  await expect(pinned).toBeVisible();
  await inputs.getByText("Selected artifacts").click();
  await expect(inputs.getByText("image:arcade", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the activity trail names each stage and folds a deployment's stage run into one entry", async ({
  page,
}) => {
  const id = await accepted(page);
  await page.goto(`/activity?entity=${id}&action=deployment.stage`);
  const entries = page.locator("ol.activity > li");
  await expect(entries).toHaveCount(1);
  const stages = entries.locator("ol.activity-stages > li");
  await expect(stages).toHaveText([
    /step-readback.*succeeded/u,
    /step-sync.*succeeded/u,
    /step-render.*succeeded/u,
  ]);
  // The whole trail of that deployment still has one entry per other action.
  await page.goto(`/activity?entity=${id}`);
  await expect(entries.filter({ hasText: "deployment.stage" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "deployment.approve" })).toContainText(
    "granted",
  );
  await expect(
    entries.filter({ hasText: "deployment.requested" }),
  ).toContainText("arcade/prod");
  await expect(
    entries.filter({ hasText: "deployment.succeeded" }),
  ).toContainText("succeeded");
  await expectNoHorizontalOverflow(page);
});

for (const scheme of ["light", "dark"] as const) {
  test(`opened evidence and the activity trail meet WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const path = `/deployments/${await accepted(page)}`;
    await expectAccessible(page, path);
    // Every disclosure open: step evidence, nested JSON and frozen inputs.
    await page.evaluate(() => {
      for (const details of globalThis.document.querySelectorAll("details"))
        details.open = true;
    });
    await expect(page.getByText('"phase": "Succeeded"')).toBeVisible();
    await expectNoViolations(page, `${path} (opened)`);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page, "/activity");
    await expectAccessible(page, "/activity?action=deployment.");
  });
}
