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
  expectNoViolations,
} from "./helpers.ts";
import { showIdle } from "./model-environment.ts";

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
 * acts; the returned function waits for the request. With `held`, the
 * request stays in flight until that promise settles, then fails.
 */
async function captureDeploymentRequest(page: Page, held?: Promise<unknown>) {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  await page.route("**/api/v1/deployments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    resolve(route.request().postDataJSON());
    await held;
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
    "40.26 of 100",
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

test("an environment with no worker pool compares only its accepted image", async ({
  page,
}) => {
  await openEnvironment(page);
  const runtime = page.getByRole("region", { name: "Live runtime" });
  await expect(runtime).toContainText("image:arcade runs the accepted digest");
  await expect(runtime).not.toContainText("retained worker build");
  await expect(runtime.getByText("succeeded", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Release state" }),
  ).toContainText("Observed when the last deployment finished");
});

test("rollback candidates mark the accepted one and exclude a lowered forward-only key", async ({
  page,
}) => {
  const seeded = await api(
    page,
    `${PROD_API}/rollback-candidates`,
    RollbackCandidatesSchema,
  );
  expect(seeded.candidates).toHaveLength(6);
  await showIdle(page, PROD);
  await openEnvironment(page);
  const region = page.getByRole("region", { name: "Rollback candidates" });
  const candidates = region.locator("ol.candidates > li");
  // Six accepted selections; the three that restore one selection with one
  // verdict share a row, so four rows and nothing collapsed.
  await expect(candidates).toHaveCount(4);
  await expect(
    region.locator("summary", { hasText: "Older candidates" }),
  ).toHaveCount(0);
  await expect(candidates.nth(0)).toContainText("Accepted now");
  await expect(
    candidates.nth(0).getByRole("button", { name: "Re-assert this selection" }),
  ).toBeEnabled();
  const rollback = { name: "Roll back to this" } as const;
  await expect(candidates.nth(1).getByRole("button", rollback)).toBeEnabled();
  const excluded =
    "would lower forwardOnly /helm/parameters/schema.version from 2 to 1";
  for (const index of [2, 3]) {
    await expect(
      candidates.nth(index).getByRole("button", rollback),
    ).toBeDisabled();
    await expect(candidates.nth(index)).toContainText(excluded);
  }
  // The shared row lists every deployment that accepted it.
  const shared = candidates.nth(3);
  await expect(shared).toContainText("Accepted 3 times, last");
  await shared.locator("summary").click();
  await expect(shared.locator(".candidate-deployments > li")).toHaveCount(3);
  for (const link of await shared.locator(".candidate-deployments a").all())
    await expect(link).toHaveAttribute("href", /^\/deployments\//u);
  // Every row's button has a name of its own.
  const names = await region
    .getByRole("button", {
      name: /^(?:Roll back to this|Re-assert this selection)/u,
    })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);
  await expectNoHorizontalOverflow(page);
});

test("a rollback candidate reads as its revision number, recipe, configuration and deployment", async ({
  page,
}) => {
  const { candidates } = await api(
    page,
    `${PROD_API}/rollback-candidates`,
    RollbackCandidatesSchema,
  );
  const [accepted] = candidates;
  if (accepted === undefined) throw new Error("seeded candidates");
  await openEnvironment(page);
  const first = page
    .getByRole("region", { name: "Rollback candidates" })
    .getByRole("listitem")
    .first();
  await expect(first).toContainText("recipe arcade/3 · configuration arcade/2");
  // The deployment id is short in sight and whole in the link's name.
  const deployment = first.getByRole("link", { name: accepted.deploymentId });
  await expect(deployment).toHaveAttribute(
    "href",
    `/deployments/${accepted.deploymentId}`,
  );
  await expect(
    deployment.getByText(accepted.deploymentId.slice(0, 8), { exact: true }),
  ).toBeVisible();
  await first.getByRole("link", { name: "r3", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/versions/${accepted.selection.versionSetRevisionId}$`, "u"),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Version set r3" }),
  ).toBeVisible();
});

test("the page leads with what runs here and what is in flight, then the release action", async ({
  page,
}) => {
  await openEnvironment(page);
  const main = page.getByRole("main");
  // The summary ends with the deployment in flight, named with its state.
  await expect(main.locator(".page-header")).toContainText(
    /Accepted r3 · Approval required · generation 6 · In flight: \Sdeploy r4 awaiting approval/u,
  );
  await expect(main.locator(".environment-notice")).toContainText(
    /^In flight: deployment \S+ is awaiting approval\. Requests, rebinds and rollbacks are refused until it finishes or is canceled\.$/u,
  );
  expect(
    await main.getByRole("heading", { level: 2 }).allTextContents(),
  ).toEqual([
    "Release state",
    "Live runtime",
    "Request a release",
    "Selection",
    "Monitor",
    "Rollback candidates",
    "Recent deployments",
  ]);
  if ((page.viewportSize()?.width ?? 0) >= 1280)
    // On a desktop screen the state needs no scrolling.
    await expect(
      main.getByRole("heading", { name: "Release state" }),
    ).toBeInViewport({ ratio: 1 });
  // The deployment in flight is one click from the summary.
  await main.getByRole("link", { name: "deploy r4 awaiting approval" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Deployment to ${PROD}` }),
  ).toBeVisible();
  await expect(
    page.getByText("This deploy asked for an override"),
  ).toBeVisible();
});

test("every confirmation asks through the page's one dialog and returns focus to its button", async ({
  page,
}) => {
  await showIdle(page, PROD);
  await openEnvironment(page);
  const region = page.getByRole("region", { name: "Rollback candidates" });
  // Several buttons here ask before acting; the page holds one dialog for them.
  await expect(page.locator("dialog")).toHaveCount(1);
  const rollback = region
    .locator("ol.candidates > li")
    .nth(1)
    .getByRole("button", { name: "Roll back to this" });
  await rollback.click();
  const asked = page.getByRole("dialog", { name: `Roll back ${PROD}?` });
  await expect(asked).toBeVisible();
  await expect(asked).toContainText("Restores the selection accepted by");
  const keep = { name: "Keep as is" } as const;
  await expect(asked.getByRole("button", keep)).toBeFocused();
  await asked.getByRole("button", keep).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(rollback).toBeFocused();
  // Another button asks its own question through the same element.
  const rebind = page
    .getByRole("region", { name: "Selection", exact: true })
    .getByRole("button", { name: "Rebind" });
  await rebind.click();
  const rebinding = page.getByRole("dialog", { name: `Rebind ${PROD}?` });
  await expect(rebinding).toBeVisible();
  await expect(rebinding).not.toContainText("Restores the selection");
  await expect(rebinding).toContainText("Keeps set revision r3");
  await expect(page.locator("dialog")).toHaveCount(1);
  await expect(page.locator("dialog h2")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(rebind).toBeFocused();
  // Confirming closes the dialog and returns focus to the button the same
  // way. The request is held in flight, so the page renders its waiting
  // state: the button reads as disabled and keeps the focus it was given.
  await rebind.click();
  const flight = Promise.withResolvers<unknown>();
  const sent = await captureDeploymentRequest(page, flight.promise);
  await confirm(page, "Request rebind");
  expect(await sent()).toMatchObject({ kind: "rebind" });
  await expect(rebind).toHaveAttribute("aria-disabled", "true");
  await expect(rebind).toBeFocused();
  // A press while it waits asks nothing and sends nothing more.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  // The request fails: the button is ready again, still focused.
  flight.resolve(null);
  await expect(
    page
      .getByRole("region", { name: "Selection", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  await expect(rebind).not.toHaveAttribute("aria-disabled");
  await expect(rebind).toBeEnabled();
  await expect(rebind).toBeFocused();
  await expect(page.locator("dialog")).toHaveCount(1);
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
  await showIdle(page, PROD);
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
    expectedGeneration: 6,
  });
});

test("rebind requests only the declared coordinate that moved", async ({
  page,
}) => {
  await showIdle(page, PROD);
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
    expectedGeneration: 6,
  });
  expect(request.configurationRevisionId).toBeUndefined();
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
  // The override, and the Cloudflare stack waiting at its approve step.
  await expect(waiting.locator("tbody tr")).toHaveCount(2);
  await expect(waiting.getByText("Override", { exact: true })).toBeVisible();
  await expect(
    waiting.getByText("Saved plan awaits decision", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Recently decided" })
      .getByText("granted", { exact: true }),
    // Three promotions, two re-assertions and the rebind.
  ).toHaveCount(6);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", {
      name: /^Approvals\s*, 2 awaiting approval$/u,
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
  await expect(entries.nth(2)).toContainText("Environments created (9)");
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
      "/",
      ENVIRONMENT,
      "/environments/arcade/beta",
      "/environments/tofu-cloudflare/prod",
      `/deployments/${z.string().parse(view.acceptedDeploymentId)}`,
      `/deployments/${await quarantined(page)}`,
      "/recovery-intents/argo/model/beta/recovery",
      `/deployments/${await waitingStack(page)}`,
      "/approvals",
      "/activity?action=catalog.",
    ])
      await expectAccessible(page, path);
  });

  test(`the grouped candidates and the open dialog meet WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await showIdle(page, PROD);
    await openEnvironment(page);
    const region = page.getByRole("region", { name: "Rollback candidates" });
    const candidates = region.locator("ol.candidates > li");
    await candidates.nth(3).locator("summary").click();
    await expect(region.locator(".candidate-deployments > li")).toHaveCount(3);
    await expectNoViolations(
      page,
      `${ENVIRONMENT} with a grouped candidate open`,
    );
    await candidates
      .nth(1)
      .getByRole("button", { name: "Roll back to this" })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page, `${ENVIRONMENT} with its dialog open`);
  });
}
