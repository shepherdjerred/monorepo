import { expect, test } from "@playwright/test";

const firstIssue = /Polish the issue creation flow/u;

test("a peek lives in the URL: Back closes it and a reload reopens it", async ({
  page,
}) => {
  await page.goto("/issues?sort=created");
  const row = page.getByRole("link", { name: firstIssue });
  await expect(row).toHaveAttribute("href", "/issues/AI-1");
  await row.click();
  await expect(page).toHaveURL(/\/issues\?sort=created&peek=AI-1$/u);
  await expect(page.getByRole("dialog")).toContainText("AI-1");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await page.goForward();
  await expect(page.getByRole("dialog")).toContainText("AI-1");

  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("AI-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
});

test("a shared peek link opens on the list and the board, and closes in place", async ({
  page,
}) => {
  await page.goto("/board?peek=AI-2");
  await expect(page.getByRole("dialog")).toContainText("AI-2");
  await expect(
    page.getByRole("dialog").getByLabel("Issue title", { exact: true }),
  ).toHaveValue("Make attachment uploads resumable");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Nothing in this tab leads back to the board, so closing must not leave it.
  await expect(page).toHaveURL(/\/board$/u);
  await expect(page.locator(".board-card").first()).toBeVisible();
});

test("modified clicks and browser chords stay with the browser", async ({
  page,
  context,
}, info) => {
  await page.goto("/issues");
  const row = page.getByRole("link", { name: firstIssue });
  await expect(row).toBeVisible();

  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Alt+c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(
    page.getByRole("dialog").getByLabel("Issue title", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  test.skip(
    info.project.name === "mobile",
    "Phones have no modifier-click; the href assertion covers long-press.",
  );
  const opened = context.waitForEvent("page");
  await row.click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await expect(tab).toHaveURL(/\/issues\/AI-1$/u);
  await expect(page).toHaveURL(/\/issues$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("typing a filter narrows the list without adding history entries", async ({
  page,
}) => {
  await page.goto("/board");
  await page.goto("/issues");
  await expect(page.getByRole("link", { name: firstIssue })).toBeVisible();
  const before = await page.evaluate(() => globalThis.history.length);
  await page
    .getByLabel("Search issues", { exact: true })
    .pressSequentially("reconciliation", { delay: 30 });
  await expect(page).toHaveURL(/\/issues\?q=reconciliation$/u);
  await expect(page.getByRole("list", { name: "Issues" })).toHaveAttribute(
    "aria-label",
    "Issues",
  );
  await expect(page.getByRole("link", { name: firstIssue })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Investigate worker restart/u }),
  ).toBeVisible();
  expect(await page.evaluate(() => globalThis.history.length)).toBe(before);
  await page.goBack();
  await expect(page).toHaveURL(/\/board$/u);
});

test("each page names itself in the document title and has one top heading", async ({
  page,
}) => {
  await page.goto("/issues");
  await expect(page).toHaveTitle("Issues — Tracker");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Issues");
  await page.goto("/board");
  await expect(page).toHaveTitle("Board — Tracker");
  await page.goto("/issues/AI-1");
  await expect(page).toHaveTitle(
    "AI-1 · Polish the issue creation flow — Tracker",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page
      .getByRole("heading", { level: 1 })
      .getByLabel("Issue title", { exact: true }),
  ).toHaveValue("Polish the issue creation flow");
  await expect(page.locator("time[datetime]").first()).toHaveAttribute(
    "title",
    /\d{4}/u,
  );
});

test("settings is reachable through the navigation on every layout", async ({
  page,
}, info) => {
  await page.goto("/issues");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByRole("link", { name: "Actors" }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Settings" })
      .click();
  } else {
    await page.getByRole("link", { name: "Settings", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/settings$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
});

test("the keyboard moves a real focus through the list and steps back out of an issue", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "Keyboard navigation is desktop.");
  await page.goto("/issues?sort=created");
  const rows = page.locator("a[data-issue-row]");
  await expect(rows.first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(0)).not.toHaveAttribute("aria-current", "true");
  await rows.nth(4).hover();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();
  const identifier = await rows.nth(0).getAttribute("data-issue-row");
  if (identifier === null) throw new Error("The focused row has no issue");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`peek=${identifier}$`, "u"));
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(rows.nth(0)).toBeFocused();

  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full issue", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/issues/${identifier}$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Escape steps back through this tab's history instead of resetting the list.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(
    new RegExp(String.raw`/issues\?sort=created&peek=${identifier}$`, "u"),
  );
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Escape on an issue opened directly returns to the issue list", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "Keyboard navigation is desktop.");
  await page.goto("/issues/AI-1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues$/u);
});

test("an explicit theme is applied before the app loads and tints the browser chrome", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("tracker.theme", "dark");
  });
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto("/issues");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const meta of await page.locator('meta[name="theme-color"]').all()) {
    await expect(meta).toHaveAttribute("content", "#1b1b1f");
  }
});
