import { expect, type Locator, type Page } from "@playwright/test";
import { RemovalListSchema } from "#shared/api.ts";
import { requestId } from "#testing/fixture-api/fixtures/requests.ts";
import { address, openAs, settle, test, violationDetails } from "./support.ts";

/*
 * The Library's Mine, Leaving soon and Removed views, the addresses they
 * replaced, and the actions that moved into them. Runs at both viewports.
 */

const views = (page: Page) =>
  page.getByRole("navigation", { name: "Library views" });

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

/**
 * Opens Removed, where Silo can be restored by either persona (the member
 * asked for it). Returns the list and the rows of The Holdovers, a film
 * someone else asked for with two versions set aside at once.
 */
async function openRemoved(page: Page, persona: "owner" | "member") {
  await openAs(page, persona, "/library/removed");
  await settle(page);
  const list = page.getByRole("list", { name: "Removed" });
  await expect(
    entry(list, "Silo").getByRole("button", { name: "Restore to library" }),
  ).toBeVisible();
  return { list, holdovers: entry(list, "The Holdovers") };
}

/**
 * Presses "Show earlier removals" until the history has none left. Each
 * press is waited out by its result, more rows in the list, because the
 * button is renamed while it loads and is gone after the last page.
 */
async function showEveryRemoval(list: Locator) {
  const page = list.page();
  const earlier = page.getByRole("button", { name: "Show earlier removals" });
  const rows = list.getByRole("heading");
  for (let press = 0; press < 5; press += 1) {
    await settle(page);
    if (!(await earlier.isVisible())) break;
    const shown = await rows.count();
    await earlier.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(shown);
  }
  await expect(earlier).toHaveCount(0);
}

test("Removed keeps restore for the people who may use it", async ({
  page,
}) => {
  const { list, holdovers } = await openRemoved(page, "member");
  // A member's history is of what they asked for. Someone else asked for The
  // Holdovers, so neither of its versions is in it.
  await expect(holdovers).toHaveCount(0);
  await expect(
    entry(list, "Moonlight").getByRole("link", { name: /Ask for it again/u }),
  ).toBeVisible();
  await expect(list).not.toContainText(/quarantin|purged|default edition/iu);

  await showEveryRemoval(list);
  await expect(entry(list, "Get Out")).toHaveCount(1);
});

/** The removal list without anything set aside: nothing is restorable. */
async function withNothingToRestore(page: Page) {
  await page.route(/\/api\/v1\/removals$/u, async (route) => {
    const response = await route.fetch();
    const rows = RemovalListSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: rows.filter((row) => row.state !== "quarantined"),
    });
  });
}

/** Counts the reads of the removal history a page makes. */
function historyReads(page: Page): { count: number } {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/removal-history") {
      reads.count += 1;
    }
  });
  return reads;
}

test("a member whose newest removals are all other people's still reaches their own", async ({
  page,
}) => {
  // The fixture's five newest removals, a whole page, are other people's, so
  // this member's first page of history is empty and has more behind it.
  // With nothing of theirs set aside either, nothing is listed up front.
  await withNothingToRestore(page);
  const reads = historyReads(page);
  await openAs(page, "member", "/library/removed");
  await settle(page);

  // The view read on past the empty page instead of calling it the end.
  await expect(
    page.getByRole("heading", { name: "Nothing has been removed" }),
  ).toHaveCount(0);
  expect(reads.count).toBe(2);
  const list = page.getByRole("list", { name: "Removed" });
  await expect(list.getByRole("heading")).toHaveText([
    "Hacks",
    "Silo",
    "Moonlight",
    "Twin Peaks",
  ]);
  // Silo is not theirs to restore here, so it has the link, not the control.
  await expect(entry(list, "Silo").getByRole("button")).toHaveCount(0);
  expect(await violationDetails(page)).toEqual([]);

  await showEveryRemoval(list);
  await expect(list.getByRole("heading")).toHaveText([
    "Hacks",
    "Silo",
    "Moonlight",
    "Twin Peaks",
    "Dark",
    "Get Out",
  ]);
});

test("a history with nothing to show for page after page says so and offers to look further", async ({
  page,
}) => {
  await withNothingToRestore(page);
  // Every page is empty and has another behind it, until `ended`.
  const history = { reads: 0, ended: false };
  await page.route(/\/api\/v1\/removal-history/u, async (route) => {
    history.reads += 1;
    await route.fulfill({
      json: {
        items: [],
        nextCursor: history.ended
          ? null
          : JSON.stringify({
              createdAt: "2026-11-01T00:00:00.000Z",
              id: `page-${String(history.reads)}`,
            }),
      },
    });
  });
  await openAs(page, "member", "/library/removed");
  await settle(page);

  // One look reads on through empty pages, but not without end.
  await expect(
    page.getByRole("heading", { name: "No removals of yours so far" }),
  ).toBeVisible();
  expect(history.reads).toBe(5);
  expect(await violationDetails(page)).toEqual([]);

  const further = page.getByRole("button", { name: "Look further back" });
  await further.click();
  await expect.poll(() => history.reads).toBe(10);
  await expect(further).toBeVisible();

  // When the history does end with nothing in it, the view says so.
  history.ended = true;
  await further.click();
  await expect(
    page.getByRole("heading", { name: "Nothing has been removed" }),
  ).toBeVisible();
  await expect(further).toHaveCount(0);
  expect(history.reads).toBe(11);
});

test("restore is offered on the removal it restores, not on another cut of the film", async ({
  page,
}) => {
  const { holdovers } = await openRemoved(page, "owner");
  await expect(holdovers).toHaveCount(2);
  await allowWrites(page);
  // The control restores the film's default version, so only that version's
  // row may carry it.
  await expect(
    holdovers.getByRole("button", { name: "Restore to library" }),
  ).toHaveCount(1);
  const cut = holdovers.filter({ hasText: "Director's cut" });
  await expect(cut).toHaveCount(1);
  await expect(cut.getByRole("button")).toHaveCount(0);
  // The other cut is recovered from the title, where versions are chosen.
  await expect(cut.getByRole("link", { name: /Open/u })).toBeVisible();

  let sent: unknown = null;
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 409,
      json: { error: { code: "conflict", message: "This title changed." } },
    });
  });
  await holdovers
    .filter({ hasNotText: "Director's cut" })
    .getByRole("button", { name: "Restore to library" })
    .click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent).toMatchObject({
    scope: { edition: "default" },
    command: { action: "restore" },
  });
});

/**
 * Answers the keep command for each episode, failing the second one while
 * `failing` is set, and makes the removal list forget every episode kept, as
 * the server does.
 */
async function partlyKeep(page: Page) {
  const commands: string[] = [];
  const state = { failing: true, commands, listed: -1 };
  const kept = new Set<string>();
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    const mediaId = new URL(route.request().url()).pathname.split("/")[4] ?? "";
    state.commands.push(mediaId);
    if (state.failing && state.commands.length === 2) {
      await route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "Try again later." } },
      });
      return;
    }
    kept.add(mediaId);
    await route.fulfill({
      json: {
        schemaVersion: 2,
        scope: { mediaId, edition: "default" },
        result: { status: "completed" },
        appliedVersions: { mediaVersion: 2, targetVersion: 5 },
      },
    });
  });
  await page.route(/\/api\/v1\/removals$/u, async (route) => {
    const response = await route.fetch();
    const rows = RemovalListSchema.parse(await response.json());
    const left = rows.filter((row) => !kept.has(row.mediaId));
    state.listed = left.filter((row) => row.rootTitle === "The Expanse").length;
    await route.fulfill({ response, json: left });
  });
  return state;
}

const PARTLY_KEPT =
  "Kept 3 of 4 episodes for 30 days. 1 could not be kept and is marked below.";

/**
 * Keeps all four episodes of The Expanse with one command failing, and
 * waits until the list has been read again and holds only that episode.
 */
async function keepAllButOne(page: Page) {
  await openAs(page, "member", "/library/leaving");
  await settle(page);
  await allowWrites(page);
  const run = await partlyKeep(page);
  const expanse = entry(
    page.getByRole("list", { name: "Leaving soon" }),
    "The Expanse",
  );
  await expanse.getByRole("button", { name: "Keep all 4 episodes" }).click();
  await expect(expanse.getByRole("status").first()).toHaveText(PARTLY_KEPT);
  await expect.poll(() => run.listed).toBe(1);
  await settle(page);
  return { run, expanse };
}

test("a partly kept series keeps its report and its retry when the list refreshes down to one episode", async ({
  page,
}) => {
  const { run, expanse } = await keepAllButOne(page);
  // Only the episode that failed is still leaving, and the report still
  // counts the four episodes the run started with.
  await expect(expanse.getByRole("status").first()).toHaveText(PARTLY_KEPT);
  await expect(expanse.getByText("Kept for 30 days")).toHaveCount(3);
  await expect(expanse.getByText("Not kept: Try again later.")).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);

  // The retry is still there, and still sends only what failed.
  run.failing = false;
  await expanse
    .getByRole("button", { name: "Try the 1 that failed again" })
    .click();
  await expect.poll(() => run.commands.length).toBe(5);
  expect(run.commands[4]).toBe(run.commands[1]);
  // Fully kept, the series leaves the list and takes its report with it.
  await expect(expanse).toHaveCount(0);
});

test("dismissing a keep-all report shows what is still leaving", async ({
  page,
}) => {
  const { expanse } = await keepAllButOne(page);
  await expanse.getByRole("button", { name: "Dismiss this report" }).click();
  await expect(expanse.getByText(PARTLY_KEPT)).toHaveCount(0);
  // One episode is left, with its own hold.
  await expect(
    expanse.getByRole("button", { name: "Keep for 30 days" }),
  ).toBeVisible();
  await expect(expanse.getByRole("button", { name: /Try the/u })).toHaveCount(
    0,
  );
});
