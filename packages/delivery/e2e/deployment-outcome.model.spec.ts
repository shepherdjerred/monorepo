import { expect, test, type Page } from "@playwright/test";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";
import { api, expectNoHorizontalOverflow } from "./helpers.ts";

// Served by e2e/model-server.ts: Arcade beta's deploy ended recovery-required
// while its sync step was still running, and the Cloudflare stack's saved
// plan waits for its decision.

async function newest(page: Page, environmentId: string) {
  const { items } = await api(
    page,
    `/api/v1/deployments?environmentId=${encodeURIComponent(environmentId)}`,
    DeploymentPageSchema,
  );
  return items;
}

async function quarantined(page: Page) {
  const items = await newest(page, "arcade/beta");
  const found = items.find((item) => item.recoveryRequired);
  if (found === undefined) throw new Error("seeded quarantine");
  return found.id;
}

test("a failed deployment says why at the top and what the operator can do", async ({
  page,
}) => {
  await page.goto(`/deployments/${await quarantined(page)}`);
  const main = page.getByRole("main");
  // Only the status is live; the relative time beside it is not.
  const headerStatus = main.locator(".page-header").getByRole("status");
  await expect(headerStatus).toHaveText("failed");
  await expect(headerStatus.locator("svg.status-glyph")).toBeVisible();
  const why = main.getByRole("region", { name: "Why it failed" });
  await expect(why).toContainText(
    "The sync outlived the executor; its result is unknown",
  );
  await expect(why).toContainText(
    "Step step-sync was still running when the deployment ended, so its outcome is unknown: ArgoCD sync operation 7 running",
  );
  await expect(why).toContainText(
    "A change may still be running outside Delivery. It must be checked before this environment unlocks.",
  );
  await expect(
    why.getByRole("link", { name: "Recovery intent 1" }),
  ).toHaveAttribute("href", "/recovery-intents/argo/model/beta/recovery");
  // It leads the page, and the message is not repeated below.
  const headings = await main
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(headings[0]).toBe("Why it failed");
  await expect(
    main.getByText("The sync outlived the executor; its result is unknown"),
  ).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});

test("once recovery settles, the page reports what it read back instead of the stale headline", async ({
  page,
}) => {
  const items = await newest(page, "arcade/beta");
  const settled = items.find(
    (item) => item.status === "failed" && !item.recoveryRequired,
  );
  if (settled === undefined) throw new Error("seeded settled interruption");
  await page.goto(`/deployments/${settled.id}`);
  const main = page.getByRole("main");
  const why = main.getByRole("region", { name: "Why it failed" });
  // One sentence: the step it ended on, then what recovery has since found.
  await expect(why).toContainText(
    "Step step-sync was still running when the deployment ended; recovery intent 1 has since read the outcome back and found arcade-beta ended in phase Failed, which does not say why it failed.",
  );
  await expect(main).not.toContainText("may still be active");
  await expect(main).not.toContainText("outcome is unknown");
  const steps = main.getByRole("region", { name: "Steps" });
  await expect(steps).toContainText(
    "interrupted · recovery read back phase Failed",
  );
  await expect(steps).not.toContainText("step-sync: running");
  await expectNoHorizontalOverflow(page);
});

test("a step its deployment outlived reads as interrupted, on the page and on the pipeline", async ({
  page,
}) => {
  const id = await quarantined(page);
  await page.clock.install();
  await page.goto(`/deployments/${id}`);
  const steps = page.getByRole("region", { name: "Steps" });
  const sync = steps
    .getByRole("listitem")
    .filter({ hasText: "step-sync" })
    .first();
  await expect(sync).toContainText("interrupted · outcome unknown");
  await expect(steps.locator(".status-running")).toHaveCount(0);
  // Its clock stopped when the deployment ended, so it reads the same later.
  const head = sync.locator(".step-head");
  const before = await head.textContent();
  await page.clock.fastForward("05:00");
  await expect(head).toHaveText(before ?? "");

  await page.goto("/pipelines/arcade");
  const beta = page
    .getByRole("region", { name: "Arcade promotion" })
    .getByRole("region", { name: "beta" });
  const action = beta.getByRole("listitem").filter({ hasText: "step-sync" });
  await expect(action).toContainText("interrupted · outcome unknown");
  await expect(action.locator(".status-running")).toHaveCount(0);
});

test("a plan rejection checks its reason before asking, and keeps it after a refusal", async ({
  page,
}) => {
  const [stack] = await newest(page, "tofu-cloudflare/prod");
  if (stack === undefined) throw new Error("seeded stack deploy");
  await page.goto(`/deployments/${stack.id}`);
  const panel = page.getByRole("region", { name: "Plan approval" });
  const reason = panel.getByRole("textbox", { name: "Reason (required)" });
  await expect(reason).toBeVisible();
  await panel.getByRole("button", { name: "Reject plan" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toHaveAccessibleDescription(
    "Record why this plan must not be applied",
  );
  await reason.fill("The tunnel route points at the wrong origin");
  await page.route("**/api/v1/deployments/*/plan-approval", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "CONFLICT",
          message: "The saved plan expired; request a new deployment",
          requestId: "e2e-refusal",
        },
      },
    }),
  );
  await panel.getByRole("button", { name: "Reject plan" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reject and discard plan" })
    .click();
  await expect(panel.getByRole("alert")).toHaveText(
    "The saved plan expired; request a new deployment",
  );
  await expect(reason).toHaveValue(
    "The tunnel route points at the wrong origin",
  );
});
