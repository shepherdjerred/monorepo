import { expect, test, type Page } from "@playwright/test";
import {
  expectNoHorizontalOverflow,
  expectStackedTable,
  isPhone,
} from "./helpers.ts";

/** The app's own layout: skip link, header, main navigation and main landmark. */
async function expectShell(page: Page) {
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("banner").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
}

test("a service filter by its display name keeps the page and filters by id", async ({
  page,
}) => {
  await page.goto("/deployments?service=Scout+for+LoL");
  await expectShell(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Deployments" }),
  ).toBeVisible();
  const table = page.getByRole("main").getByRole("table");
  await expect(table.locator("tbody tr").first()).toContainText(
    "Scout for LoL prod",
  );
  await expect(table).not.toContainText("minecraft/tsmc");

  // Typing what the overview shows, or part of it, finds the same service.
  for (const typed of ["Scout for LoL", "scout"]) {
    await page.goto("/deployments");
    const filters = page.getByRole("search", { name: "Filter deployments" });
    await filters.getByLabel("Service").fill(typed);
    await filters.getByLabel("Service").press("Enter");
    await expect(page).toHaveURL(/\/deployments\?service=scout-for-lol$/u);
    await expect(filters.getByLabel("Service")).toHaveValue("scout-for-lol");
    await expect(
      page.getByRole("status").filter({
        hasText:
          /^Showing \d+ deployments? that match these filters, newest first\.$/u,
      }),
    ).toBeVisible();
    await expect(table.locator("tbody tr").first()).toContainText(
      "Scout for LoL prod",
    );
  }
  // The environment suggestions name every environment of the catalog.
  await expect(
    page.locator("datalist#environment-options option[value='arcade/prod']"),
  ).toHaveCount(1);
});

test("a filter the server would refuse explains itself inside the page", async ({
  page,
}) => {
  await page.goto("/deployments?service=No+such+service");
  await expectShell(page);
  const main = page.getByRole("main");
  await expect(main.getByRole("status")).toHaveText(
    "No service is named “No such service”. Choose one from the list.",
  );
  await expect(main.getByRole("table")).toHaveCount(0);
  await main.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/deployments$/u);
  await expect(main.getByRole("table")).toBeVisible();

  // With the unfiltered list already loaded, a filter that cannot be
  // resolved still shows no rows and no paging from it.
  const filter = page.getByRole("search", { name: "Filter deployments" });
  await filter.getByLabel("Service").fill("No such service");
  await filter.getByRole("button", { name: "Filter" }).click();
  await expect(main.getByRole("status")).toHaveText(
    "No service is named “No such service”. Choose one from the list.",
  );
  await expect(main.getByRole("table")).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Older" })).toHaveCount(0);
  await main.getByRole("link", { name: "Clear filters" }).click();
  await expect(main.getByRole("table")).toBeVisible();
  await expect(
    page
      .getByRole("search", { name: "Filter deployments" })
      .getByLabel("Service"),
  ).toHaveValue("");

  // A filter that matches nothing says so, live, and offers the way back.
  await page.goto("/artifacts?service=flipt");
  await expect(main.getByRole("status")).toHaveText(
    "No builds match these filters.",
  );
  await expect(main.getByRole("link", { name: "Clear filters" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a cursor the server refuses keeps the layout and offers no useless retry", async ({
  page,
}) => {
  await page.goto("/deployments?cursor=bogus");
  await expectShell(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "This page cannot be shown" }),
  ).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("Invalid page cursor");
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await page.getByRole("link", { name: "Clear filters and paging" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Deployments" }),
  ).toBeVisible();
});

for (const path of [
  "/deployments/00000000-0000-4000-8000-000000000000",
  "/deployments/not-a-uuid",
  "/environments/arcade/nope",
  "/pipelines/nope",
  "/commits/zzzz",
])
  test(`${path} answers inside the app's layout`, async ({ page }) => {
    await page.goto(path);
    await expectShell(page);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(
      /^(Not found|This page cannot be shown)$/u,
    );
    await expect(heading).toBeFocused();
    await expect(page.getByRole("main")).not.toContainText("(INVALID)");
    await expect(page.getByRole("main")).not.toContainText("(NOT_FOUND)");
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("main").getByRole("link").first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

test("every list page shares the section eyebrow and a filter panel", async ({
  page,
}) => {
  for (const [path, title] of [
    ["/deployments", "Deployments"],
    ["/approvals", "Approvals"],
    ["/artifacts", "Artifacts"],
    ["/activity", "Activity"],
  ] as const) {
    await page.goto(path);
    const header = page.locator(".page-header");
    await expect(header.locator(".eyebrow")).toHaveText("Homelab CI/CD");
    await expect(header.getByRole("heading", { level: 1 })).toHaveText(title);
    if (path !== "/approvals")
      await expect(page.locator(".panel").getByRole("search")).toBeVisible();
  }
});

test("deployments say when recovery is required and name links by what they open", async ({
  page,
}) => {
  await page.goto("/deployments?environment=minecraft%2Ftsmc");
  const row = page
    .getByRole("main")
    .locator("tbody tr")
    .filter({ hasText: "recovery required" })
    .first();
  await expect(row).toContainText("failed · recovery required");
  await expect(
    row.getByRole("link", {
      name: /^Deployment to minecraft\/tsmc, deploy r\d+, /,
    }),
  ).toHaveText(/tsmc$/u);
  // The overview's name in sight, the environment's id in its title.
  await expect(row.locator('span[title="minecraft/tsmc"]')).toBeVisible();
  await expect(
    row.getByRole("link", { name: /^Version set r\d+$/u }),
  ).toHaveText(/^r\d+$/u);
});

test("paging moves to the top of the list and back to the newest", async ({
  page,
}) => {
  await page.goto("/activity");
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByRole("link", { name: "Newest" })).toHaveCount(0);
  await pages.getByRole("link", { name: "Older" }).click();
  await expect(page).toHaveURL(/\/activity\?cursor=/u);
  const top = page.getByRole("heading", { level: 2, name: "Audit trail" });
  await expect(top).toBeFocused();
  // Rows that fold several entries are counted as rows, the entries beside them.
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    /older (?:entries|rows of \d+ entries)/u,
  );
  await pages.getByRole("link", { name: "Newest" }).click();
  await expect(page).toHaveURL(/\/activity$/u);
  await expect(top).toBeFocused();
});

test("activity labels its columns, puts the actor beside the action and marks failures", async ({
  page,
}) => {
  await page.goto("/activity?action=deployment.failed");
  const entries = page.locator("ol.activity > li");
  await expect(entries.first()).toBeVisible();
  const columns = page.locator(".activity-columns");
  if (isPhone(page)) await expect(columns).toBeHidden();
  else {
    await expect(columns).toHaveText("WhenActionByAbout", {
      useInnerText: false,
    });
    // The actor sits right after the action, not across the page.
    const action = await entries
      .first()
      .locator(".activity-action")
      .boundingBox();
    const actor = await entries
      .first()
      .locator(".activity-actor")
      .boundingBox();
    if (action === null || actor === null) throw new Error("row is laid out");
    expect(actor.x - (action.x + action.width)).toBeLessThan(40);
  }
  // The action reads in plain words; its recorded code stays in the title.
  await expect(
    entries.first().locator(".activity-action .status-failed"),
  ).toHaveText(/Deployment failed/u);
  await expect(entries.first().locator(".activity-action")).toHaveAttribute(
    "title",
    "deployment.failed",
  );
  await expect(
    entries.first().getByRole("link", { name: /^Deployment [0-9a-f-]{36}$/u }),
  ).toBeVisible();
});

test("activity counts the rows it renders, names its time zone and says why a deployment failed", async ({
  page,
}) => {
  await page.goto("/activity");
  const entries = page.locator("ol.activity > li");
  await expect(entries.first()).toBeVisible();
  const rendered = await entries.count();
  // The count is of rows; folded runs say how many entries they hold.
  await expect(
    page.getByRole("status").filter({ hasText: /^Showing / }),
  ).toHaveText(
    new RegExp(
      String.raw`^Showing ${String(rendered)} (?:entries|rows of \d+ entries), newest first\.$`,
      "u",
    ),
  );
  const zone = /Times are (UTC(?:[+-]\d{1,2}(?::\d{2})?)?)\./u.exec(
    (await page.locator(".page-header .subtitle").textContent()) ?? "",
  )?.[1];
  if (zone === undefined) throw new Error("the header names the time zone");
  await expect(entries.first().locator("time").first()).toHaveAttribute(
    "title",
    new RegExp(` ${zone.replace("+", String.raw`\+`)}$`, "u"),
  );
  // A stage written running and then succeeded reads once, as succeeded.
  for (const run of await page.locator(".activity-stages").all()) {
    const stages = await run.locator(".mono").allTextContents();
    expect(new Set(stages).size).toBe(stages.length);
  }

  await page.goto("/activity?action=deployment.failed");
  const failure = page.locator("ol.activity > li").first();
  await expect(failure.locator(".activity-reason")).not.toBeEmpty();
});

test("an environment's recent deployments do not repeat the environment on every row", async ({
  page,
}) => {
  await page.goto("/environments/scout-for-lol/prod");
  const recent = page.getByRole("region", { name: "Recent deployments" });
  await expect(recent.getByRole("table")).toBeVisible();
  await expect(recent.locator("thead")).toContainText("Kind");
  await expect(recent.locator("tbody")).not.toContainText("scout-for-lol/prod");
  // The release state names its set revisions by number, the id in the title.
  const state = page.getByRole("region", { name: "Release state" });
  for (const revision of await state.locator(".revision").all())
    await expect(revision).toHaveAttribute("title", /\S/u);
  await expect(state.locator(".identifier")).toHaveCount(0);
});

test("on a phone each table row stacks under its labels without sideways scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, region] of [
    ["/environments/scout-for-lol/prod", "Recent deployments"],
    ["/deployments", "Deployment history"],
  ] as const) {
    await page.goto(path);
    await expectStackedTable(page.getByRole("region", { name: region }));
    await expectNoHorizontalOverflow(page);
  }
});
