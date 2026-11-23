import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";

/** The instant `minutes` before nine o'clock on the fixture day. */
const at = (minutes: number) =>
  new Date(Date.UTC(2026, 10, 20, 9, 0) - minutes * 60_000).toISOString();

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

test("repeated check-ins and worker retirements fold into counted rows that name their environment, and a failed recovery says why", async ({
  page,
}) => {
  let sequence = 0;
  const entry = (
    action: string,
    entityId: string,
    minutes: number,
    extra: Record<string, unknown> = {},
  ) => {
    sequence += 1;
    return {
      id: `repeat-audit-${String(sequence)}`,
      actor: action.startsWith("worker.retirement")
        ? "delivery/auto-retire"
        : "executor",
      action,
      entityId,
      requestId: `repeat-request-${String(sequence)}`,
      metadata: {},
      occurredAt: at(minutes),
      target: action.startsWith("deployment.")
        ? { kind: "deployment", id: entityId }
        : null,
      ...extra,
    };
  };
  const retirement = (minutes: number) =>
    entry("worker.retirement_requested", "scout-beta-worker", minutes, {
      subject: {
        serviceId: "scout-for-lol",
        environmentId: "scout-for-lol/beta",
        revision: 338,
      },
    });
  const items = [
    entry("deployment.lease_renewed", "check-in-deployment", 0),
    entry("deployment.lease_renewed", "check-in-deployment", 1),
    entry("deployment.lease_renewed", "check-in-deployment", 2),
    retirement(3),
    retirement(8),
    retirement(13),
    entry("worker.recovery_failed", "recovery-deployment", 20, {
      metadata: { message: "The pool read back a different build" },
      reason: "The pool read back a different build",
    }),
    entry("worker.recovery_failed", "silent-deployment", 21, { reason: null }),
  ];
  await page.route("**/api/v1/activity*", (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );
  await page.goto("/activity");
  const rows = page.locator("ol.activity > li");
  await expect(rows).toHaveCount(4);

  const checkIns = rows.filter({ hasText: "Executor checked in" });
  await expect(checkIns).toHaveCount(1);
  await expect(checkIns).toContainText("×3");
  await expect(checkIns).toContainText("3 check-ins");

  // The retirement names where it happens, and spans the minutes it repeated.
  const retirements = rows.filter({ hasText: "Worker retirement requested" });
  await expect(retirements).toHaveCount(1);
  await expect(retirements).toContainText("×3");
  await expect(retirements).toContainText("scout-for-lol/beta");
  await expect(retirements).toContainText("r338");
  await expect(retirements).toContainText("from ");
  await retirements.getByText("3 requests").click();
  await expect(retirements.locator(".activity-repeated > li")).toHaveCount(3);

  const failed = rows.filter({ hasText: "Worker recovery failed" });
  await expect(failed.first()).toContainText(
    "The pool read back a different build",
  );
  await expect(failed.nth(1)).toContainText("No cause was recorded");
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
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
