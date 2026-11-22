import { expect, test } from "@playwright/test";
import { HubOverviewSchema } from "#shared/hub/hub-contract.ts";
import {
  api,
  expectNoHorizontalOverflow,
  requestArcadeDeployment,
} from "./helpers.ts";
import { FAILED_COMMIT_TITLE, LONG_COMMIT_TITLE } from "./commits.ts";

const ROUTES = [
  ["/", "Overview"],
  ["/commits", "Commits"],
  ["/commits/aaaaaaa", "Commit aaaaaaa"],
  ["/pipelines", "Pipelines"],
  ["/pipelines/arcade", "Arcade"],
  ["/pipelines/arcade/executions", "Arcade"],
  ["/environments/arcade/prod", "arcade/prod"],
  ["/environments/gitops/tofu:openai", "gitops/tofu:openai"],
  ["/deployments", "Deployments"],
  ["/approvals", "Approvals"],
  ["/artifacts", "Artifacts"],
  ["/activity", "Activity"],
] as const;

test("every route deep-links to its own page and title", async ({ page }) => {
  for (const [path, title] of ROUTES) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Delivery`);
    await expectNoHorizontalOverflow(page);
  }
  const hub = await api(page, "/api/v1/hub", HubOverviewSchema);
  const build = hub.services.find(
    (service) => service.id === "arcade",
  )?.latestBuild;
  if (build === null || build === undefined)
    throw new Error("Arcade build fixture required");
  await page.goto(`/builds/${build.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Change / }),
  ).toBeVisible();
  await page.goto("/no/such/page");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible();
});

test("the commit list answers per environment", async ({ page }) => {
  await page.goto("/commits");
  await expect(page).toHaveURL(/\/commits$/u);
  await page.getByRole("link", { name: /^aaaaaaa/u }).click();
  await expect(page).toHaveURL(/\/commits\/a{40}$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  const main = page.getByRole("main");
  await expect(
    main.getByText("feat(arcade): publish the arcade fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByText("by shepherdjerred", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "By environment" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /^prod/u })).toContainText(
    /services? live/u,
  );
  await page.goBack();
  const search = page.getByRole("search", { name: "Find a commit" });
  await search.getByLabel("Commit SHA").fill("aaaaaaa");
  await search.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(/\/commits\/aaaaaaa$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Commit aaaaaaa" }),
  ).toBeVisible();
});

test("commits show their title and author, and page to older ones", async ({
  page,
}) => {
  await page.goto("/commits");
  const recent = page.getByRole("region", { name: "Recent commits" });
  const rows = recent.getByRole("listitem");
  const arcade = rows.filter({
    has: page.getByRole("link", { name: /^aaaaaaa/u }),
  });
  await expect(arcade.getByRole("link", { name: /^aaaaaaa/u })).toHaveText(
    "aaaaaaa feat(arcade): publish the arcade fixture",
  );
  await expect(arcade).toContainText("shepherdjerred");
  // A commit whose CI failed still has its title, and a title with one long
  // unbreakable token wraps inside its row. The next commit passed, so the
  // row says where its change went rather than "CI failed".
  await expect(rows.filter({ hasText: FAILED_COMMIT_TITLE })).toContainText(
    "Not built on its own",
  );
  await expect(recent.getByText(LONG_COMMIT_TITLE)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const pages = recent.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByRole("link", { name: "Newest" })).toHaveCount(0);
  await pages.getByRole("link", { name: "Older" }).click();
  await expect(page).toHaveURL(/\/commits\?cursor=/u);
  await expect(
    recent.getByRole("link", {
      name: "01c0ffe feat(birmel): add the voice session store",
    }),
  ).toBeVisible();
  await expect(recent.getByRole("link", { name: /^aaaaaaa/u })).toHaveCount(0);
  // Delivery saw this commit before it captured titles: the sha stands alone.
  await expect(
    recent.getByRole("link", { name: "03c0ffe", exact: true }),
  ).toBeVisible();
  await expect(pages.getByRole("link", { name: "Older" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await pages.getByRole("link", { name: "Newest" }).click();
  await expect(page).toHaveURL(/\/commits$/u);
  await expect(recent.getByRole("link", { name: /^aaaaaaa/u })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/commits\?cursor=/u);
  await expect(
    recent.getByRole("link", { name: "03c0ffe", exact: true }),
  ).toBeVisible();
});

test("the pipelines list filters through the URL", async ({ page }) => {
  await page.goto("/pipelines");
  await expect(page).toHaveURL(/\/pipelines$/u);
  const table = page.getByRole("table");
  await expect(
    table.getByRole("row").filter({
      has: page.getByRole("link", { name: "Arcade", exact: true }),
    }),
  ).toContainText("CI run #1");
  const filters = page.getByRole("search", { name: "Filter pipelines" });
  await filters.getByLabel("Name").fill("arcade");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/pipelines\?q=arcade$/u);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  // A submit keeps focus on its button; the form is not remounted.
  await expect(filters.getByRole("button", { name: "Filter" })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/pipelines$/u);
  await expect(rows).not.toHaveCount(1);
  // The control follows the URL through history, not what was last typed.
  await expect(filters.getByLabel("Name")).toHaveValue("");
  await expect(rows).not.toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/pipelines\?q=arcade$/u);
  await expect(filters.getByLabel("Name")).toHaveValue("arcade");
  await expect(rows).toHaveCount(1);
});

test("links keep history: back and forward restore each page", async ({
  page,
}) => {
  await page.goto("/pipelines");
  await page.getByRole("link", { name: "Arcade", exact: true }).click();
  await expect(page).toHaveURL(/\/pipelines\/arcade$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  await page
    .getByRole("navigation", { name: "Service views" })
    .getByRole("link", { name: "Executions" })
    .click();
  await expect(page).toHaveURL(/\/pipelines\/arcade\/executions$/u);
  await expect(
    page.getByRole("heading", { level: 2, name: "Executions" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/pipelines\/arcade$/u);
  await expect(
    page.getByRole("region", { name: "Arcade promotion" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveTitle("Pipelines · Delivery");
  await page.goForward();
  await expect(page).toHaveTitle("Arcade · Delivery");
});

test("links are real anchors that open in a new tab", async ({
  page,
  context,
}) => {
  await page.goto("/pipelines");
  const link = page.getByRole("link", { name: "Arcade", exact: true });
  await expect(link).toHaveAttribute("href", "/pipelines/arcade");
  const opened = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/pipelines/arcade");
  await expect(page).toHaveURL(/\/pipelines$/u);
  await tab.close();
});

test("keyboard users reach content first and dialogs return focus", async ({
  page,
}) => {
  await page.goto("/environments/scout-for-lol/prod");
  await expect(
    page.getByRole("region", { name: "Retained workers" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/u);
  const trigger = page
    .getByRole("region", { name: "Retained workers" })
    .getByRole("button", { name: "Request retirement" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep as is" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keyboard activation of a navigation link moves focus to the page heading like a click", async ({
  page,
}) => {
  await page.goto("/");
  const main = page.getByRole("navigation", { name: "Main" });
  // Enter on a focused link.
  await main.getByRole("link", { name: "Activity" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/activity$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Activity", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#main-heading")).toBeFocused();
  await main.getByRole("link", { name: "Artifacts" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/artifacts$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  // The brand link is a link too.
  await page.getByRole("link", { name: "Delivery", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  // A navigation that does not change the page keeps focus where it was.
  await page.goto("/pipelines");
  await main.getByRole("link", { name: "Pipelines" }).focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("link", { name: "Pipelines" })).toBeFocused();
});

for (const activation of ["keyboard", "click"] as const)
  test(`focus reaches the heading by ${activation} even in a tab that runs no animation frames`, async ({
    page,
  }) => {
    // A background or hidden tab never runs requestAnimationFrame, so focus
    // cannot wait for one.
    await page.addInitScript(() => {
      globalThis.requestAnimationFrame = () => 0;
    });
    await page.goto("/");
    await expect(page.locator("#main-heading")).toBeVisible();
    const link = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Activity" });
    if (activation === "keyboard") {
      await link.focus();
      await page.keyboard.press("Enter");
    } else await link.click();
    await expect(page).toHaveURL(/\/activity$/u);
    await expect(page.locator("#main-heading")).toBeFocused();
  });

test("focus reaches the heading of a page that was slow to load", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#main-heading")).toBeVisible();
  await page.route("**/api/v1/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  const link = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Artifacts" });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/artifacts$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
});

test("the skip link moves focus into the main landmark", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.locator("#main-heading")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/u);
  // Focus is on the landmark, not left on the body, so the next Tab reaches
  // the first control of the page rather than the masthead again.
  await expect(page.locator("#main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#main :focus")).toHaveCount(1);
  await expect(page.locator("#main")).not.toBeFocused();
});

test("committed changes appear live without a reload", async ({
  page,
  baseURL,
}) => {
  await page.goto("/deployments?environment=arcade%2Fprod");
  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();
  const rows = page.getByRole("main").getByRole("row");
  const before = await rows.count();
  const { deployment, cancel } = await requestArcadeDeployment(page, baseURL);
  await expect(rows).toHaveCount(before + (before === 0 ? 2 : 1));
  await cancel();
  await expect(
    page.locator(`tr:has(a[href="/deployments/${deployment.id}"])`),
  ).toContainText("canceled");
});

test("deployment lists name a release by its revision number", async ({
  page,
}) => {
  // The link says what it opens; its visible text stays the bare number.
  const revision = /^Version set r\d+$/u;
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;
  await page.goto("/deployments?environment=scout-for-lol%2Fprod");
  const list = page.getByRole("main").getByRole("table");
  await expect(
    list.getByRole("link", { name: revision }).first(),
  ).toBeVisible();
  await expect(list).not.toContainText(uuid);
  await page.goto("/environments/scout-for-lol/prod");
  const recent = page.getByRole("region", { name: "Recent deployments" });
  await expect(recent.getByRole("table")).not.toContainText(uuid);
  await recent.getByRole("link", { name: revision }).first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Version set r\d+$/u }),
  ).toBeVisible();
});
