import { expect, test } from "@playwright/test";

import {
  DESKTOP,
  expectPagesFitViewport,
  gotoLoadedPage,
  PHONE,
  violations,
} from "./helpers.ts";

// The fixture server seeds, through the incidents service: INC-1 resolved
// (Tracker), INC-2 scheduled database maintenance (no owner), INC-3 red main
// owned by its suspect, INC-4 sev1 Delivery under a live dispatch lease, and
// INC-5 an unowned observability incident past its takeover grace.

test("lists the seeded open incidents, most severe first, with command state", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/incidents");
  await expect(page).toHaveTitle("Open incidents · Hub");
  const table = page.getByRole("table", { name: "Open incidents" });
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("INC-4");
  await expect(rows.nth(0)).toContainText("SEV1");
  await expect(rows.nth(0)).toContainText("Dispatching to new session until");
  await expect(rows.nth(1)).toContainText("INC-3");
  await expect(rows.nth(1)).toContainText(
    "Owned by claude-code · temporal-schedule-split",
  );
  await expect(rows.nth(2)).toContainText("INC-5");
  await expect(rows.nth(3)).toContainText("PostgreSQL minor upgrade");
  // Maintenance has an owner or not; takeover language is for incidents.
  await expect(rows.nth(3)).toContainText("No owner");
  await expect(rows.nth(3)).not.toContainText("eligible");
  await expect(table).not.toContainText("Tracker API returned 502s");

  await page.getByLabel("System", { exact: true }).selectOption("main-ci");
  await expect(page).toHaveURL(/system=main-ci/u);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("INC-3");

  await gotoLoadedPage(page, "/incidents/history");
  await expect(
    page.getByRole("table", { name: "Incident history" }),
  ).toContainText("Tracker API returned 502s after the views migration");

  expect(await violations(page)).toEqual([]);

  await gotoLoadedPage(page, "/");
  const home = page.getByRole("region", { name: "Incidents" });
  await expect(home).toContainText("INC-4");
  await expect(home).toContainText("Maintenance windows");
  await home.getByRole("link", { name: /INC-4/u }).click();
  await expect(page).toHaveURL(/\/incidents\/INC-4$/u);
});

test("detail renders the record, signals, affected agents, and the full timeline", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/incidents/INC-3");
  await expect(page).toHaveTitle("INC-3 · Incidents · Hub");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "main is red: pipeline #19256 failed verify",
    }),
  ).toBeVisible();
  const timeline = page.getByRole("list", { name: "Timeline, newest first" });
  await expect(timeline.getByRole("listitem")).toHaveCount(5);
  await expect(timeline).toContainText(
    "Fix PR #5145 is green locally; waiting on Woodpecker.",
  );
  await expect(timeline).toContainText("investigating → identified");
  await expect(timeline).toContainText("Took command");
  await expect(timeline).toContainText("Signal firing");
  await expect(page.getByText("PR #5142 · c39e98ac531c")).toBeVisible();

  await gotoLoadedPage(page, "/incidents/INC-4");
  await expect(page.getByText("Lease held by codex")).toBeVisible();
  await expect(page.getByRole("table", { name: "Signals" })).toContainText(
    "Firing",
  );
  expect(await violations(page)).toEqual([]);
});

test("Take on an unowned, eligible incident makes the viewer commander", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/incidents/INC-5");
  const command = page.locator(".inc-command-panel");
  await expect(command).toContainText("Unowned — takeover eligible now");

  await command.getByRole("button", { name: "Take command" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "You hold command of INC-5.",
  );
  await expect(command).toContainText("Owned by Hub browser");
  await expect(
    page.getByRole("list", { name: "Timeline, newest first" }),
  ).toContainText("Took command");

  // Release again through the dialog, so the shared fixture stays unowned.
  await command.getByRole("button", { name: "Release" }).click();
  const dialog = page.getByRole("dialog", { name: "Release INC-5" });
  await expect(dialog.getByLabel("Release note")).toBeFocused();
  await dialog.getByLabel("Release note").fill("Handing back.");
  await dialog.getByRole("button", { name: "Release command" }).click();
  await expect(dialog).toBeHidden();
  await expect(command).toContainText("Unowned — takeover eligible now");
});

test("maintenance shows its owner without takeover language", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/incidents/INC-2");
  const owner = page.locator(".inc-command-panel");
  await expect(owner.getByRole("heading", { name: "Owner" })).toBeVisible();
  await expect(owner).toContainText("No owner");
  await expect(owner).not.toContainText("eligible");
  await expect(
    owner.getByRole("button", { name: "Take ownership" }),
  ).toBeVisible();
});

test("declaring onto a held system offers to join the existing incident", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/incidents/new");
  await page.getByLabel("Title").fill("Delivery claims answer BUSY");
  await page.getByRole("checkbox", { name: "Delivery" }).check();
  await page.getByLabel("Exit condition").fill("Queued deployments dispatch.");
  await page.getByRole("button", { name: "Declare incident" }).click();

  const notice = page.getByRole("alert");
  await expect(
    notice.getByRole("heading", { name: "INC-4 already covers Delivery" }),
  ).toBeFocused();
  await expect(notice).toContainText(
    "temporal-workers requires recovery and holds the Delivery dispatch barrier",
  );
  await notice.getByRole("button", { name: "Join it instead" }).click();
  await expect(page).toHaveURL(/\/incidents\/INC-4$/u);
  await expect(page.locator(".inc-detail")).toContainText("Hub browser");
});

test("incident pages fit a phone without sideways scrolling", async ({
  page,
}) => {
  await expectPagesFitViewport(page, PHONE, [
    "/incidents",
    "/incidents/INC-4",
    "/incidents/new",
  ]);
});
