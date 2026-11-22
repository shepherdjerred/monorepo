import { expect, test } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectStackedTable,
  isPhone,
} from "./helpers.ts";

// Served by e2e/model-server.ts, whose Arcade prod override and Cloudflare
// stack wait for a decision that no spec makes.

test("approvals put the waiting decisions first, named by service, environment and release", async ({
  page,
}) => {
  await page.goto("/approvals");
  const waiting = page.getByRole("region", {
    name: /^Waiting for a decision \(2\)$/u,
  });
  await expect(waiting).toHaveClass(/panel-waiting/u);
  const row = waiting.locator("tbody tr").filter({ hasText: "Override" });
  await expect(
    row.getByRole("link", {
      name: /^Deployment to arcade\/prod, deploy r4, requested /,
    }),
  ).toHaveText("Arcade · prod");
  // The release reads as its set revision's number, not a bare id.
  await expect(
    row.getByRole("link", { name: "Version set r4", exact: true }),
  ).toHaveText("r4");
  await expectNoHorizontalOverflow(page);
  if (isPhone(page)) await expectStackedTable(waiting);
});

test("an undecided approval reads awaiting approval and its release wraps with the revision first", async ({
  page,
}) => {
  await page.goto("/approvals");
  const waiting = page.getByRole("region", {
    name: /^Waiting for a decision/u,
  });
  // Both the override waiting on its approval and the saved plan waiting on its
  // decision are "awaiting approval", as the other pages say.
  const states = waiting.locator("td[data-label='Approval'] .status");
  await expect(states).toHaveCount(2);
  for (const state of await states.all())
    await expect(state).toHaveText(/awaiting approval$/u);
  await expect(waiting).not.toContainText(/\bpending\b/u);
  const release = waiting
    .locator("tbody tr")
    .filter({ hasText: "Override" })
    .locator("td[data-label='Release']");
  await expect(release.locator("a").first()).toHaveText(/^r\d+$/u);
  const parts = release.locator(".release-parts");
  await expect(parts).toContainText("recipe");
  // The ids are shown whole and wrap inside the cell.
  await expect(parts).not.toContainText("…");
  expect(
    await parts.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("on a phone every destination and the waiting count are in sight", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/approvals");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of [
    "Overview",
    "Commits",
    "Pipelines",
    "Deployments",
    "Approvals",
    "Artifacts",
    "Activity",
  ])
    await expect(
      nav.getByRole("link", { name: new RegExp(`^${name}`, "u") }),
    ).toBeInViewport({ ratio: 1 });
  const approvals = nav.getByRole("link", {
    name: /^Approvals\s*, 2 awaiting approval$/u,
  });
  await expect(approvals).toHaveAttribute("aria-current", "page");
  await expect(approvals.locator(".nav-count")).toBeInViewport({ ratio: 1 });
  expect(
    await nav.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
