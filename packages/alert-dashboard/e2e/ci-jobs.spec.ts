import { expect, test } from "@playwright/test";

import { ciJobsFixture } from "./ci-jobs-fixture.ts";
import { horizontalOverflow, PHONE } from "./helpers.ts";

const ROUTE = "/services/ci";
const API = "**/api/v1/ops/ci";

test("CI queue groups jobs and retains keyboard focus and filters across refresh", async ({
  page,
}) => {
  const fixture = ciJobsFixture();
  let requests = 0;
  await page.clock.install();
  await page.route(API, async (route) => {
    requests += 1;
    await route.fulfill({ json: fixture });
  });
  await page.goto(ROUTE);

  const queue = page.getByRole("region", { name: "Woodpecker queue" });
  await expect(queue).toContainText("Instance-wide");
  await expect(queue.getByText("Oldest queued pipeline age")).toBeVisible();
  await expect(queue.getByText("8m", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Kueue admission" }),
  ).toContainText("Gates pending");

  const active = page.getByRole("table", { name: "Active monorepo workflows" });
  const recent = page.getByRole("table", {
    name: "Recent completed monorepo runs",
  });
  await expect(active.getByRole("link", { name: "verify" })).toHaveAttribute(
    "href",
    /1821\/1$/u,
  );
  await expect(active).toContainText("Rough PR CI finish");
  await expect(active).toContainText("Attempt 2");
  await expect(active).toContainText("Waiting for verify");
  await expect(recent).toContainText("Passed");

  const stateSort = active.getByRole("button", { name: "State" });
  await stateSort.focus();
  await page.keyboard.press("Enter");
  await expect(
    active.getByRole("columnheader", { name: "State" }),
  ).toHaveAttribute("aria-sort", "ascending");
  await expect(stateSort).toBeFocused();

  const filter = page.getByRole("searchbox", { name: /Filter monorepo runs/u });
  await filter.fill("PR #42 running");
  await expect(active).toContainText("Running");
  await expect(active).not.toContainText("ci-complete");
  await expect(recent).toContainText("No matching completed runs.");
  await page.clock.fastForward(31_000);
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(filter).toHaveValue("PR #42 running");
  await expect(filter).toBeFocused();
});

test("stale CI jobs remain readable on a phone and omit finish estimates", async ({
  page,
}) => {
  const fixture = ciJobsFixture();
  if (fixture.sample?.queue == null || fixture.sample.jobs === null) {
    throw new Error("Expected queue and job fixtures");
  }
  fixture.sample.queue.paused = true;
  fixture.sample.jobs.partial = true;
  fixture.sample.admission = null;
  fixture.stale = true;
  fixture.unavailableSources = ["admission"];
  await page.setViewportSize(PHONE);
  await page.route(API, (route) => route.fulfill({ json: fixture }));
  await page.goto(ROUTE);
  await expect(
    page.getByText("CI data is stale.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("The Woodpecker queue is paused.")).toBeVisible();
  await expect(
    page.getByText("Some monorepo workflows could not be loaded."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Kueue admission" }),
  ).toContainText("Unavailable");
  const active = page.getByRole("table", { name: "Active monorepo workflows" });
  await expect(active).toContainText("PR #42");
  await expect(active).toContainText("ETA unavailable");
  await expect(active).not.toContainText("Rough PR CI finish");
  expect(await horizontalOverflow(page)).toEqual({ document: 0, main: 0 });
});

test("CI dashboard shows empty jobs and respects the off flag", async ({
  page,
}) => {
  const fixture = ciJobsFixture();
  if (fixture.sample?.jobs == null) throw new Error("Expected job fixtures");
  fixture.sample.jobs.active = [];
  fixture.sample.jobs.recent = [];
  await page.route(API, (route) => route.fulfill({ json: fixture }));
  await page.goto(ROUTE);
  await expect(page.getByText("No active workflows reported.")).toBeVisible();
  await expect(page.getByText("No completed runs reported.")).toBeVisible();

  fixture.enabled = false;
  const response = page.waitForResponse((item) =>
    item.url().endsWith("/api/v1/ops/ci"),
  );
  await page.reload();
  await response;
  await expect(
    page.getByRole("region", { name: "CI jobs and queue" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Woodpecker active CI pods", { exact: true }),
  ).toBeVisible();
});
