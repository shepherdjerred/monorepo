import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";

test("one deployment's steps read as one activity row, each step once, however other entries interleave", async ({
  page,
}) => {
  const deployment = "fold-deployment";
  let sequence = 0;
  const entry = (
    action: string,
    metadata: Record<string, unknown>,
    actor: string,
  ) => {
    sequence += 1;
    return {
      id: `fold-audit-${String(sequence)}`,
      actor,
      action,
      entityId: deployment,
      requestId: `fold-request-${String(sequence)}`,
      metadata,
      occurredAt: new Date(
        Date.UTC(2026, 10, 20, 9, 0, 60 - sequence),
      ).toISOString(),
      target: { kind: "deployment", id: deployment },
    };
  };
  // Newest first: the step succeeded, the executor checked in, and the step
  // had been running twice, once under another actor.
  const items = [
    entry(
      "deployment.stage",
      { stage: "worker-image-provenance", status: "succeeded" },
      "executor",
    ),
    entry("deployment.lease_renewed", {}, "executor"),
    entry(
      "deployment.stage",
      { stage: "worker-image-provenance", status: "running" },
      "operator@example.com",
    ),
    entry(
      "deployment.stage",
      { stage: "worker-image-provenance", status: "running" },
      "executor",
    ),
  ];
  await page.route("**/api/v1/activity*", (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );
  await page.goto("/activity");
  const rows = page.locator("ol.activity > li");
  await expect(rows).toHaveCount(2);
  const steps = rows.first().locator("ol.activity-stages > li");
  await expect(steps).toHaveCount(1);
  await expect(steps.first()).toContainText("worker-image-provenance");
  await expect(steps.first()).toContainText("succeeded");
  await expect(steps.first()).toContainText("3 updates");
  await expect(rows.nth(1)).toContainText("Executor checked in");
  await expect(
    page.getByRole("status").filter({ hasText: /^Showing / }),
  ).toHaveText(
    "Showing all 2 rows (4 events, steps and repeats folded). Newest first.",
  );
});

test("an environment lists what was deployed before its retained builds, and its panels share a row's height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/environments/scout-for-lol/prod");
  const retained = page.getByRole("region", { name: "Retained workers" });
  const recent = page.getByRole("region", { name: "Recent deployments" });
  await expect(retained).toBeVisible();
  await expect(recent).toBeVisible();
  const [recentBox, retainedBox] = await Promise.all([
    recent.boundingBox(),
    retained.boundingBox(),
  ]);
  if (recentBox === null || retainedBox === null)
    throw new Error("both panels are laid out");
  expect(recentBox.y + recentBox.height).toBeLessThanOrEqual(retainedBox.y);
  // Release state and Live runtime sit side by side at the same height, so
  // the shorter one leaves no blank gap beneath it.
  const [state, runtime] = await Promise.all([
    page.getByRole("region", { name: "Release state" }).boundingBox(),
    page.getByRole("region", { name: "Live runtime" }).boundingBox(),
  ]);
  if (state === null || runtime === null)
    throw new Error("both panels are laid out");
  expect(Math.abs(state.y - runtime.y)).toBeLessThan(2);
  expect(Math.abs(state.height - runtime.height)).toBeLessThan(2);
  await expectNoHorizontalOverflow(page);
});
