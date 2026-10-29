import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { CreateDeploymentV2Schema } from "#shared/deployment-request-contract.ts";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";
import { EnvironmentSelectionSchema } from "#shared/model/route-contract.ts";
import { RollbackCandidatesSchema } from "#shared/model/selection-contract.ts";
import {
  api,
  confirm,
  expectAccessible,
  expectNoHorizontalOverflow,
} from "./helpers.ts";

// Served by e2e/model-server.ts: Arcade's catalog, releases, monitor, restore
// hold and a quarantined beta deploy, recorded through Delivery's own APIs.
const PROD = "arcade/prod";
const ENVIRONMENT = `/environments/${PROD}`;
const PROD_API = `/api/v1/environments/${encodeURIComponent(PROD)}`;

async function openEnvironment(page: Page) {
  await page.goto(ENVIRONMENT);
  await expect(
    page.getByRole("heading", { level: 1, name: PROD }),
  ).toBeVisible();
}

/**
 * Capture the next deployment request without sending it, so every spec
 * reads the same seeded record; the server's admission of each kind is
 * covered by its integration tests. The route is in place before the caller
 * acts; the returned function waits for the request.
 */
async function captureDeploymentRequest(page: Page) {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  await page.route("**/api/v1/deployments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    resolve(route.request().postDataJSON());
    return route.abort("failed");
  });
  return async () => CreateDeploymentV2Schema.parse(await promise);
}

test("the environment shows its monitor and binding", async ({ page }) => {
  await openEnvironment(page);
  const monitor = page.getByRole("region", { name: "Monitor", exact: true });
  await expect(monitor.getByText("alarmed", { exact: true })).toBeVisible();
  await expect(monitor).toContainText("Hold for an operator on alarm");
  await expect(monitor).toContainText(
    "The environment is held for an operator.",
  );
  const evidence = monitor.getByRole("table", {
    name: "Evidence against threshold",
  });
  await expect(evidence.getByRole("row", { name: /requests/u })).toContainText(
    "40 of 100",
  );
  await expect(evidence.getByRole("row", { name: /requests/u })).toContainText(
    "Below threshold",
  );
  await expect(monitor).toContainText("ArcadeErrorBudgetBurn");
  await expect(monitor).toContainText("window 15m");
  const selection = page.getByRole("region", {
    name: "Selection",
    exact: true,
  });
  await expect(selection).toContainText("durable");
  await expect(selection).toContainText("Human approval required");
  await expect(selection).toContainText("arcade/4 · differs from accepted");
  await expectNoHorizontalOverflow(page);
});

test("rollback candidates mark the accepted one and exclude a lowered forward-only key", async ({
  page,
}) => {
  await openEnvironment(page);
  const candidates = page
    .getByRole("region", { name: "Rollback candidates" })
    .getByRole("listitem");
  await expect(candidates).toHaveCount(4);
  await expect(candidates.nth(0)).toContainText("Accepted now");
  await expect(
    candidates.nth(0).getByRole("button", { name: "Re-assert this selection" }),
  ).toBeEnabled();
  const rollback = { name: "Roll back to this" } as const;
  await expect(candidates.nth(1).getByRole("button", rollback)).toBeEnabled();
  for (const index of [2, 3]) {
    await expect(
      candidates.nth(index).getByRole("button", rollback),
    ).toBeDisabled();
    await expect(candidates.nth(index)).toContainText(
      "would lower forwardOnly /helm/parameters/schema.version from 2 to 1",
    );
  }
});

test("rolling back to a candidate requests its exact selection", async ({
  page,
}) => {
  const { candidates } = await api(
    page,
    `${PROD_API}/rollback-candidates`,
    RollbackCandidatesSchema,
  );
  const target = candidates[1];
  if (target === undefined) throw new Error("seeded candidates");
  await openEnvironment(page);
  await page
    .getByRole("region", { name: "Rollback candidates" })
    .getByRole("listitem")
    .nth(1)
    .getByRole("button", { name: "Roll back to this" })
    .click();
  const sent = await captureDeploymentRequest(page);
  await confirm(page, "Request rollback");
  expect(await sent()).toMatchObject({
    environmentId: PROD,
    kind: "rollback",
    selectionDeploymentId: target.deploymentId,
    expectedGeneration: 4,
  });
});

test("rebind requests only the declared coordinate that moved", async ({
  page,
}) => {
  await openEnvironment(page);
  await page
    .getByRole("region", { name: "Selection", exact: true })
    .getByRole("button", { name: "Rebind" })
    .click();
  const sent = await captureDeploymentRequest(page);
  await confirm(page, "Request rebind");
  const request = await sent();
  expect(request).toMatchObject({
    kind: "rebind",
    recipeRevisionId: "arcade/4",
    expectedGeneration: 4,
  });
  expect(request.configurationRevisionId).toBeUndefined();
});

test("a deploy can ask for an override approval", async ({ page }) => {
  await openEnvironment(page);
  const form = page.getByRole("region", { name: "Request a release" });
  await form.getByLabel("Action").selectOption("deploy");
  const version = form.getByLabel("Version set");
  await version.selectOption({ index: 1 });
  const chosen = await version.inputValue();
  const override = form.getByRole("checkbox", {
    name: /Ask for an override approval/u,
  });
  await override.check();
  await expect(override).toBeChecked();
  const sent = await captureDeploymentRequest(page);
  await form.getByRole("button", { name: "Request deployment" }).click();
  expect(await sent()).toMatchObject({
    environmentId: PROD,
    kind: "deploy",
    versionSetRevisionId: chosen,
    override: true,
    expectedGeneration: 4,
  });
});

test("an accepted promotion shows its steps, selection, previous selection and approval", async ({
  page,
}) => {
  const view = await api(
    page,
    `${PROD_API}/selection`,
    EnvironmentSelectionSchema,
  );
  const accepted = z.string().parse(view.acceptedDeploymentId);
  await page.goto(`/deployments/${accepted}`);
  const steps = page.getByRole("region", { name: "Steps" });
  for (const step of ["step-render", "step-sync", "step-readback"])
    await expect(steps).toContainText(step);
  const selection = page.getByRole("region", {
    name: "Selection",
    exact: true,
  });
  await expect(selection).toContainText("arcade/3");
  await expect(selection).toContainText("arcade/2");
  await expect(
    page.getByRole("region", { name: "Previous accepted selection" }),
  ).toContainText("Accepted by");
  await expect(
    page.getByRole("region", { name: "Approval" }).getByText("granted", {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

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

/** The Cloudflare stack deploy the harness left waiting at its approve step. */
async function waitingStack(page: Page) {
  const { items } = await api(
    page,
    `/api/v1/deployments?environmentId=${encodeURIComponent("tofu-cloudflare/prod")}`,
    DeploymentPageSchema,
  );
  const [deployment] = items;
  if (deployment === undefined) throw new Error("seeded stack deploy");
  return deployment.id;
}

test("a tofu approve step shows its saved plan and decides it by digest", async ({
  page,
}) => {
  const id = await waitingStack(page);
  await page.goto(`/deployments/${id}`);
  const panel = page.getByRole("region", { name: "Plan approval" });
  await expect(panel).toContainText(`sha256:${"7".repeat(64)}`);
  await expect(panel).toContainText(
    "Create 2 · update 1 · delete 0 · replace 0",
  );
  await expect(panel).toContainText("cloudflare · state serial 41");
  await expect(
    panel.getByRole("button", { name: "Reject plan" }),
  ).toBeEnabled();
  const decisions: unknown[] = [];
  await page.route("**/api/v1/deployments/*/plan-approval", async (route) => {
    decisions.push(route.request().postDataJSON());
    await route.abort("failed");
  });
  await panel.getByLabel("Reason").fill("Two DNS records and one tunnel route");
  await panel.getByRole("button", { name: "Approve plan" }).click();
  await expect.poll(() => decisions.length).toBe(1);
  // A rejection is the same one decision on the same digest (4.13, H3).
  await panel.getByRole("button", { name: "Reject plan" }).click();
  await page.getByRole("button", { name: "Reject and discard plan" }).click();
  await expect.poll(() => decisions.length).toBe(2);
  expect(decisions).toEqual(
    (["approved", "rejected"] as const).map((decision) => ({
      decision,
      planDigest: `sha256:${"7".repeat(64)}`,
      reason: "Two DNS records and one tunnel route",
    })),
  );
  await expectNoHorizontalOverflow(page);
});

test("a quarantined deployment links its recovery intent", async ({ page }) => {
  await page.goto(`/deployments/${await quarantined(page)}`);
  await page
    .getByRole("region", { name: "Recovery intents" })
    .getByRole("link", { name: "Intent 1" })
    .click();
  await expect(page).toHaveURL(
    /\/recovery-intents\/argo\/model\/beta\/recovery$/u,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Recovery intent 1" }),
  ).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByText("pending", { exact: true })).toBeVisible();
  await expect(main).toContainText("sync");
  await expect(main).toContainText("once ArgoCD settles operation 7");
  await expectNoHorizontalOverflow(page);
});

test("approvals show the waiting override, the waiting saved plan and recently decided approvals", async ({
  page,
}) => {
  await page.goto("/approvals");
  const waiting = page.getByRole("region", { name: "Waiting for a decision" });
  // The header, the override, and the Cloudflare stack waiting at its approve step.
  await expect(waiting.getByRole("row")).toHaveCount(3);
  await expect(waiting.getByText("Override", { exact: true })).toBeVisible();
  await expect(
    waiting.getByText("Saved plan awaits decision", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Recently decided" })
      .getByText("granted", { exact: true }),
  ).toHaveCount(4);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", {
      name: /^Approvals\s*, 2 waiting$/u,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await waiting.getByRole("link", { name: PROD }).click();
  await expect(
    page.getByText("This deploy asked for an override"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve override" }),
  ).toBeVisible();
});

test("the activity trail shows what each catalog reconcile changed", async ({
  page,
}) => {
  await page.goto("/activity?action=catalog.");
  const entries = page.locator("ol.activity > li");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("Environments rebound (1)");
  await expect(entries.nth(0)).toContainText("Recipe revisions created (1)");
  await expect(entries.nth(1)).toContainText(
    "Configuration revisions created (1)",
  );
  await expect(entries.nth(2)).toContainText("Environments created (7)");
  await expectNoHorizontalOverflow(page);
});

for (const scheme of ["light", "dark"] as const) {
  test(`model pages meet WCAG 2.2 AA in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const view = await api(
      page,
      `${PROD_API}/selection`,
      EnvironmentSelectionSchema,
    );
    for (const path of [
      ENVIRONMENT,
      `/deployments/${z.string().parse(view.acceptedDeploymentId)}`,
      `/deployments/${await quarantined(page)}`,
      "/recovery-intents/argo/model/beta/recovery",
      `/deployments/${await waitingStack(page)}`,
      "/approvals",
      "/activity?action=catalog.",
    ])
      await expectAccessible(page, path);
  });
}
