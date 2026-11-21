import { expect, test, type Locator } from "@playwright/test";
import { MONOREPO_BUILD_WORKFLOWS } from "#testing/enrichment-fixture.ts";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers.ts";

// Arcade's newest build ran every monorepo CI lane, so its Build stage holds
// fourteen workflows, as each production service's does.

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (bounds === null) throw new Error("Element is not rendered");
  return bounds;
}

/** The graph shows every stage without scrolling sideways. */
async function expectGraphFits(graph: Locator) {
  expect(
    await graph.evaluate((region) => region.scrollWidth <= region.clientWidth),
  ).toBe(true);
}

test("the promotion graph fits a 1280px window with its transitions along the top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/pipelines/arcade");
  const graph = page.getByRole("region", { name: "Arcade promotion" });
  await expect(graph.getByRole("heading", { level: 3 })).toHaveText([
    "Source",
    "Build",
    "Test",
    "Version set",
    "beta",
    "prod",
  ]);
  await expect(graph.getByText("14 workflows passed")).toBeVisible();
  await expectGraphFits(graph);
  await expectNoHorizontalOverflow(page);

  // Every stage starts on one line, side by side, at its own height.
  const cards = await graph.getByRole("region").all();
  const stages = await Promise.all(cards.map((stage) => box(stage)));
  expect(stages).toHaveLength(6);
  const top = Math.min(...stages.map((stage) => stage.y));
  for (const stage of stages) expect(stage.y - top).toBeLessThan(1);
  for (const [index, stage] of stages.entries()) {
    const previous = stages[index - 1];
    if (previous !== undefined)
      expect(stage.x).toBeGreaterThanOrEqual(previous.x + previous.width);
  }
  const heights = stages.map((stage) => stage.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(40);

  // The transitions read across the top, above every stage.
  const transitions = graph.getByText(
    /^(Automatic|On request|Promotion|Approval required)$/u,
  );
  await expect(transitions).toHaveText([
    "Automatic",
    "Automatic",
    "Automatic",
    "On request",
    "Approval required",
  ]);
  for (const transition of await transitions.all()) {
    const label = await box(transition);
    expect(label.y + label.height).toBeLessThanOrEqual(top);
  }
});

test("a long stage shows its summary and expands to every action", async ({
  page,
}) => {
  await page.goto("/pipelines/arcade");
  const graph = page.getByRole("region", { name: "Arcade promotion" });
  const build = graph.getByRole("region", { name: "Build" });
  // The run Delivery qualified stays in view beside the summary.
  await expect(
    build
      .getByRole("list", { name: "Build actions" })
      .getByRole("link", { name: "Woodpecker #104", exact: true })
      .first(),
  ).toBeVisible();
  const summary = build.getByText("14 workflows passed");
  await expect(summary).toBeVisible();
  const workflows = build.getByRole("list", { name: "Build workflows" });
  await expect(workflows).toBeHidden();

  await summary.click();
  const rows = workflows.locator("> li");
  await expect(rows).toHaveCount(MONOREPO_BUILD_WORKFLOWS.length);
  for (const [index, name] of MONOREPO_BUILD_WORKFLOWS.entries()) {
    const row = rows.nth(index);
    await expect(row.getByText(name, { exact: true })).toBeVisible();
    await expect(row).toContainText("succeeded");
    await expect(
      row.getByRole("link", { name: `Woodpecker ${name}` }),
    ).toBeVisible();
  }
  // The longest names wrap inside their stage instead of widening it.
  await expectGraphFits(graph);
  await expectNoHorizontalOverflow(page);

  await summary.click();
  await expect(workflows).toBeHidden();
});

test("a workflow that passed never reads as a failure", async ({ page }) => {
  await page.goto("/pipelines/arcade");
  const graph = page.getByRole("region", { name: "Arcade promotion" });
  // A short stage lists its actions without a summary to open.
  const tests = graph
    .getByRole("region", { name: "Test" })
    .getByRole("list", { name: "Test actions" })
    .locator("> li");
  await expect(tests).toHaveCount(4);
  // Woodpecker stopped this workflow's tracing service with exit code 137.
  const stopped = tests.filter({ hasText: "docker-e2e" });
  await expect(stopped).toContainText("succeeded");
  await expect(stopped).toContainText("2 steps");
  await expect(graph).not.toContainText("exited");
});

for (const scheme of ["light", "dark"] as const) {
  test(`a collapsed stage meets WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, "/pipelines/arcade");
  });
}

test("a stage card leaves a step's machine receipt to the deployment page", async ({
  page,
}) => {
  // The plan step reports the native job it started as a JSON receipt.
  await page.goto("/pipelines/tofu-cloudflare");
  const graph = page.getByRole("region", {
    name: "OpenTofu cloudflare stack promotion",
  });
  await expect(graph.getByRole("link", { name: "step-plan" })).toBeVisible();
  await expect(graph).not.toContainText('{"');
});
