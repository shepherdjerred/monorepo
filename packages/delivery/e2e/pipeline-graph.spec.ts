import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers.ts";
import { RUNNING_PIPELINE, RUNNING_SERVICE } from "./pipeline-graph.ts";

const PIPELINE = `/pipelines/${RUNNING_SERVICE}`;

test("a run in progress shows its failing workflow without expanding", async ({
  page,
}) => {
  await page.goto(PIPELINE);
  const graph = page.getByRole("region", {
    name: "Streambot & media promotion",
  });
  const build = graph.getByRole("region", { name: "Build" });
  await expect(build.getByRole("heading", { level: 3 })).toHaveText("Build");
  await expect(build).toContainText("failed");
  await expect(
    build
      .getByRole("list", { name: "Build actions" })
      .getByRole("link", {
        name: `Woodpecker #${String(RUNNING_PIPELINE)}`,
        exact: true,
      })
      .first(),
  ).toBeVisible();

  // The list is open: what failed leads it, then what is running.
  await expect(
    build.getByText("12 passed · 1 failed · 1 running"),
  ).toBeVisible();
  const rows = build
    .getByRole("list", { name: "Build workflows" })
    .locator("> li");
  await expect(rows).toHaveCount(14);
  const failing = rows.nth(0);
  await expect(failing.getByText("helm-push", { exact: true })).toBeVisible();
  await expect(failing).toContainText("failed");
  await expect(failing.getByText("Step helm-push-step exited 1")).toBeVisible();
  await expect(rows.nth(1).getByText("images", { exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText("running");
  await expect(rows.nth(2)).toContainText("succeeded");

  // A short stage lists its workflows in the run's own order.
  const tests = graph
    .getByRole("region", { name: "Test" })
    .getByRole("list", { name: "Test actions" })
    .locator("> li");
  await expect(tests).toHaveText([
    /verify/u,
    /playwright-e2e/u,
    /docker-e2e/u,
    /semgrep/u,
  ]);
  await expect(tests.nth(1)).toContainText("running");
  // A workflow still waiting has no failure to report.
  await expect(tests.nth(2)).toContainText("pending");
  await expect(tests.nth(2)).toContainText("2 steps");

  expect(
    await graph.evaluate((region) => region.scrollWidth <= region.clientWidth),
  ).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("a running stage spins only when motion is welcome", async ({ page }) => {
  await page.goto(PIPELINE);
  const running = page
    .getByRole("region", { name: "Streambot & media promotion" })
    .getByRole("region", { name: "Test" });
  await expect(running).toContainText("running");
  const animations = () =>
    page.evaluate(() => globalThis.document.getAnimations().length);
  expect(await animations()).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animations()).toBe(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`an open list of workflows meets WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, PIPELINE);
  });
}
