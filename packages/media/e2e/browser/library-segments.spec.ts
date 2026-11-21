import { expect, type Locator, type Page } from "@playwright/test";
import { requestId } from "#testing/fixture-api/fixtures/requests.ts";
import { openAs, test, violationDetails } from "./support.ts";

/*
 * The Library's Mine, Leaving soon and Removed views, the addresses they
 * replaced, and the actions that moved into them. Runs at both viewports.
 */

const views = (page: Page) =>
  page.getByRole("navigation", { name: "Library views" });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading" }),
  ).toHaveCount(0);
}

function address(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/** The entry of a list whose heading is exactly `name`. */
function entry(list: Locator, name: string): Locator {
  return list.getByRole("listitem").filter({
    has: list.page().getByRole("heading", { name, exact: true }),
  });
}

/** The fixture API is read-only; writes are answered here. */
async function allowWrites(page: Page) {
  await page
    .context()
    .addCookies([
      { name: "media-csrf", value: "browser-test", url: page.url() },
    ]);
}

test("each view has its own address, and switching keeps focus on the control", async ({
  page,
}) => {
  await openAs(page, "member", "/library");
  await settle(page);
  await expect(views(page).getByRole("link")).toHaveCount(4);
  for (const name of ["All", "Mine", "Leaving soon, 6 titles", "Removed"]) {
    await expect(
      views(page).getByRole("link", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(views(page).locator('[aria-current="page"]')).toHaveText("All");

  const mine = views(page).getByRole("link", { name: "Mine" });
  await mine.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/library\/mine$/u);
  await expect(views(page).locator('[aria-current="page"]')).toHaveText("Mine");
  // The reader switched views; they did not leave the page.
  await expect(mine).toBeFocused();
  await expect(
    page.getByRole("list", { name: "What you asked for" }),
  ).toBeVisible();

  await page.reload();
  await expect(views(page).locator('[aria-current="page"]')).toHaveText("Mine");
  await page.goBack();
  await expect(page).toHaveURL(/\/library$/u);
});

for (const [from, to] of [
  ["/requests", "/library/mine"],
  // The address the personal-request import tells people to open.
  ["/requests?view=mine", "/library/mine?view=mine"],
  ["/removals", "/library/leaving"],
  ["/removed", "/library/removed"],
  ["/library/no-such-view", "/library"],
] as const) {
  test(`${from} opens ${to}`, async ({ page }) => {
    await openAs(page, "member", from);
    await expect.poll(() => address(page)).toBe(to);
    await expect(
      page.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
  });
}

test("a reminder's link opens Mine at the request it names", async ({
  page,
}) => {
  // Ted Lasso's request: far enough down the list to need scrolling.
  const linked = requestId(14);
  await openAs(page, "member", `/requests?interest=${linked}`);
  await expect
    .poll(() => address(page))
    .toBe(`/library/mine?interest=${linked}`);
  const list = page.getByRole("list", { name: "What you asked for" });
  const marked = list.locator('[data-highlighted="true"]');
  await expect(marked).toHaveCount(1);
  await expect(marked.getByRole("heading")).toHaveText("Ted Lasso");
  await expect(marked).toBeInViewport();
  // Its controls are open: the answer is one press away.
  await expect(
    marked.getByRole("button", { name: "Keep watching" }),
  ).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);
});

test("Mine lists each title once, with every action a request has", async ({
  page,
}) => {
  await openAs(page, "member", "/library/mine");
  await settle(page);
  const list = page.getByRole("list", { name: "What you asked for" });
  const names = await list.getByRole("heading").allTextContents();
  expect(names.length).toBeGreaterThan(15);
  expect(new Set(names).size).toBe(names.length);
  // Titles waiting on an answer are first, with their controls open.
  expect(names.slice(0, 3)).toEqual(["Shōgun", "Slow Horses", "The Bear"]);
  await expect(
    entry(list, "Shōgun").getByText(/Still watching\? Choose Keep watching/u),
  ).toBeVisible();
  // One main action per entry: answering the check, not the 30-day hold.
  const shogun = entry(list, "Shōgun");
  await expect(shogun.locator(".button.primary")).toHaveText("Keep watching");
  await expect(
    shogun.getByRole("button", { name: "Keep for 30 days" }),
  ).toBeVisible();
  // A film's poster comes from its row in the request list; a title with no
  // stored artwork gets a marked tile, not an empty one.
  await expect(entry(list, "Alien").locator("img")).toHaveCount(1);
  const arrival = entry(list, "Arrival");
  await expect(arrival.locator("img")).toHaveCount(0);
  await expect(arrival.locator("svg").first()).toBeVisible();
  // A season's request is under its series, in the member's words.
  await expect(entry(list, "Andor")).toContainText("Season 2");
  await expect(list).not.toContainText(
    /Policy needs review|Unmarked|_pending|needs_/u,
  );

  // A series request: follow, finish, stop, hold, cancel.
  const dark = entry(list, "Dark");
  await expect(dark.getByRole("button")).toHaveCount(0);
  await dark.getByText("Manage this request").click();
  for (const name of [
    "Keep watching",
    "I have finished it",
    "Stop following",
    "Keep for 30 days",
    "Cancel request",
  ]) {
    await expect(dark.getByRole("button", { name })).toBeVisible();
  }
  // A film request: cancel, clear the edition choice, keep the edition.
  const film = entry(list, "Blade Runner");
  await film.getByText("Manage this request").click();
  for (const name of [
    "Cancel request",
    "Clear edition choice, keep request",
    "Keep this edition",
  ]) {
    await expect(film.getByRole("button", { name })).toBeVisible();
  }
  expect(await violationDetails(page)).toEqual([]);
});

test("the owner changes how long a request is kept, and can view a managed profile's films", async ({
  page,
}) => {
  await openAs(page, "owner", "/library/mine");
  await settle(page);
  const list = page.getByRole("list", { name: "What you asked for" });
  const dark = entry(list, "Dark");
  await dark.getByText("Manage this request").click();
  await expect(
    dark.getByRole("button", { name: "Keep for good" }),
  ).toBeVisible();
  await expect(page.getByLabel("Show film requests of")).toHaveValue(/.+/u);
});

test("Leaving soon keeps a whole series' episodes in one action and reports each", async ({
  page,
}) => {
  await openAs(page, "member", "/library/leaving");
  await settle(page);
  await allowWrites(page);
  const list = page.getByRole("list", { name: "Leaving soon" });
  await expect(list.getByRole("heading")).toHaveText([
    "Get Out",
    "The Expanse",
    "Mr. Robot",
    "Cowboy Bebop",
    "Knives Out",
    "Top Gun: Maverick",
  ]);
  // A title leaving whole has its own hold.
  await expect(
    entry(list, "Get Out").getByRole("button", { name: "Keep for 30 days" }),
  ).toBeVisible();

  // The existing per-episode command, once per episode; the second fails.
  const commands: string[] = [];
  const keys: (string | undefined)[] = [];
  let failing = true;
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    const body: unknown = route.request().postDataJSON();
    const mediaId = new URL(route.request().url()).pathname.split("/")[4] ?? "";
    commands.push(mediaId);
    keys.push(route.request().headers()["idempotency-key"]);
    expect(body).toMatchObject({
      schemaVersion: 2,
      scope: { mediaId, edition: "default" },
      command: { action: "keep" },
    });
    if (failing && commands.length === 2) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "Try again later." } },
      });
      return;
    }
    await route.fulfill({
      json: {
        schemaVersion: 2,
        scope: { mediaId, edition: "default" },
        result: { status: "completed" },
        appliedVersions: { mediaVersion: 2, targetVersion: 5 },
      },
    });
  });

  const expanse = entry(list, "The Expanse");
  await expanse.getByRole("button", { name: "Keep all 4 episodes" }).click();
  await expect(expanse.getByRole("status").first()).toHaveText(
    "Kept 3 of 4 episodes for 30 days. 1 could not be kept and is marked below.",
  );
  expect(new Set(commands).size).toBe(4);
  // The ones that succeeded stay reported beside the one that did not.
  await expect(expanse.getByText("Kept for 30 days")).toHaveCount(3);
  await expect(expanse.getByText("Not kept: Try again later.")).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);

  // Trying again sends only the failed episode, the same command as before.
  failing = false;
  await expanse
    .getByRole("button", { name: "Try the 1 that failed again" })
    .click();
  await expect(expanse.getByRole("status").first()).toHaveText(
    "Kept all 4 episodes for 30 days.",
  );
  expect(commands).toHaveLength(5);
  expect(commands[4]).toBe(commands[1]);
  expect(keys[4]).toBe(keys[1]);
  expect(new Set(keys).size).toBe(4);
  await expect(expanse.getByRole("button", { name: /Keep all/u })).toHaveCount(
    0,
  );
});

test("Removed keeps restore for the people who may use it", async ({
  page,
}) => {
  await openAs(page, "member", "/library/removed");
  await settle(page);
  const list = page.getByRole("list", { name: "Removed" });
  // The member asked for Silo; someone else asked for The Holdovers.
  await expect(
    entry(list, "Silo").getByRole("button", { name: "Restore to library" }),
  ).toBeVisible();
  const holdovers = entry(list, "The Holdovers");
  await expect(holdovers.getByRole("button")).toHaveCount(0);
  await expect(holdovers.getByRole("link", { name: /Open/u })).toBeVisible();
  await expect(
    entry(list, "Moonlight").getByRole("link", { name: /Ask for it again/u }),
  ).toBeVisible();
  await expect(list).not.toContainText(/quarantin|purged|default edition/iu);

  await page.getByRole("button", { name: "Show earlier removals" }).click();
  await expect(
    page.getByRole("button", { name: "Show earlier removals" }),
  ).toHaveCount(0);
});

test("the owner can restore anything still set aside", async ({ page }) => {
  await openAs(page, "owner", "/library/removed");
  await settle(page);
  const list = page.getByRole("list", { name: "Removed" });
  for (const name of ["Silo", "The Holdovers"]) {
    await expect(
      entry(list, name).getByRole("button", { name: "Restore to library" }),
    ).toBeVisible();
  }
});
