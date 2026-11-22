import { expect, type Page, type Route } from "@playwright/test";
import { NowPlayingSchema } from "#shared/household/playback.ts";
import { MEMBER } from "#testing/fixture-api/personas.ts";
import {
  address,
  inScenario,
  openAs,
  horizontalOverflow,
  settle,
  test,
  violationDetails,
} from "./support.ts";

/*
 * History: what is playing now, the statistics as tiles and ranked bars, and
 * the list of plays with its search, its filters and its paging. An owner
 * reads the household's plays; a member reads their own.
 */

const section = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
const plays = (page: Page) => page.getByRole("list", { name: "Plays" });
const tile = (page: Page, label: string) =>
  section(page, "Statistics")
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");

const HISTORY_READS = /\/api\/v1\/playback\/history/u;
const STATISTICS_READS = /\/api\/v1\/playback\/statistics/u;
const NOW_PLAYING_READS = /\/api\/v1\/playback\/now-playing/u;

test("the owner sees every stream, the household's numbers, and plays that link to their titles", async ({
  page,
}) => {
  await openAs(page, "owner", "/history");
  await settle(page);
  await expect(page).toHaveTitle("History · Media");

  // Now playing: a card per stream, with who, where, and how far through.
  const streams = section(page, "Now playing").getByRole("listitem");
  await expect(streams).toHaveCount(2);
  await expect(streams.nth(0)).toContainText("Severance");
  await expect(streams.nth(0)).toContainText("Chikhai Bardo");
  await expect(streams.nth(0)).toContainText("Robin, on Apple TV");
  await expect(streams.nth(0)).toContainText("Playing");
  await expect(streams.nth(0)).toContainText("Played as it is");
  await expect(streams.nth(1)).toContainText("Kids, on LG webOS");
  await expect(streams.nth(1)).toContainText("Paused");
  await expect(streams.nth(1)).toContainText("Converted for the device");
  await expect(
    streams.nth(0).getByRole("link", { name: "Severance" }),
  ).toHaveAttribute("href", /^\/media\/[\da-f-]+$/u);
  const position = streams.nth(1).getByRole("progressbar");
  await expect(position).toHaveAccessibleName("Spirited Away: how far through");
  await expect(streams.nth(1)).toContainText("of 125 min");

  // Statistics: three totals and four rankings.
  await expect(tile(page, "Plays")).toHaveText(/^[\d,]+$/u);
  await expect(tile(page, "Watch time")).toHaveText(/^[\d,]+ hr$/u);
  // The count, then its share of plays.
  await expect(tile(page, "Finished")).toHaveText(/^[\d,]+% of plays$/u);
  const statistics = section(page, "Statistics");
  await expect(statistics.getByRole("heading", { level: 3 })).toHaveText([
    "Most watched",
    "By person",
    "By device",
    "How it played",
  ]);
  const watched = section(page, "Most watched").getByRole("listitem");
  await expect(watched.first()).toContainText(/\d+ plays/u);
  await expect(watched.first()).toContainText(/\d+ hr/u);
  await expect(section(page, "How it played")).toContainText("Played as it is");

  // Plays: one page, then another; nothing is replaced.
  const rows = plays(page).getByRole("listitem");
  await expect(rows).toHaveCount(25);
  const first = rows.first();
  await expect(first.getByRole("link")).toHaveAttribute(
    "href",
    /^\/media\/[\da-f-]+$/u,
  );
  await expect(first.locator("time")).toHaveAttribute(
    "datetime",
    /^\d{4}-\d\d-\d\dT/u,
  );
  await expect(first).toContainText(/ on (LG webOS|Apple TV|Chrome|iOS)/u);
  await expect(first).toContainText(/Finished|Partly watched/u);
  // An account matched to nobody is said to be, not left blank.
  await expect(plays(page)).toContainText("Unmapped account");

  const firstTitle = await first.innerText();
  await page.getByRole("button", { name: "Show more plays" }).click();
  await expect(rows).toHaveCount(50);
  expect(await rows.first().innerText()).toBe(firstTitle);
  await page.getByRole("button", { name: "Show more plays" }).click();
  await expect(rows).toHaveCount(64);
  await expect(
    page.getByRole("button", { name: "Show more plays" }),
  ).toHaveCount(0);
  // An older play that matches no title the household holds today is still
  // named, and links nowhere.
  const unlinked = rows.filter({ hasNot: page.getByRole("link") });
  expect(await unlinked.count()).toBeGreaterThan(0);
  await expect(unlinked.first().locator("span").first()).toHaveText(/\S/u);
  expect(await unlinked.count()).toBeLessThan(64);

  // No member-facing contract value, and nothing wider than the screen.
  await expect(page.locator("#main")).not.toContainText(
    /direct_|transcode|tautulli|direct play|direct stream/iu,
  );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await violationDetails(page)).toEqual([]);
});

test("the bars are drawn from their values, with no style written into the page", async ({
  page,
}) => {
  await openAs(page, "owner", "/history");
  await settle(page);
  const bars = section(page, "Most watched").locator("progress");
  const drawn = await bars.evaluateAll((elements) =>
    elements.map((element) => ({
      value: Number(element.getAttribute("value")),
      max: Number(element.getAttribute("max")),
      hidden: element.getAttribute("aria-hidden"),
      width: Math.round(element.getBoundingClientRect().width),
    })),
  );
  expect(drawn.length).toBeGreaterThan(3);
  // The busiest row fills its track; the rest are in order beneath it.
  expect(drawn[0]?.value).toBe(drawn[0]?.max);
  expect(drawn.map((bar) => bar.value)).toEqual(
    drawn.map((bar) => bar.value).sort((left, right) => right - left),
  );
  expect(new Set(drawn.map((bar) => bar.max)).size).toBe(1);
  expect(new Set(drawn.map((bar) => bar.width)).size).toBe(1);
  // Each bar repeats its row's words, so only the words are read out.
  expect(new Set(drawn.map((bar) => bar.hidden))).toEqual(new Set(["true"]));
  // The policy would refuse an inline width; the suite fails on a refusal.
  await expect(page.locator("#main [style]")).toHaveCount(0);
});

test("a member sees their own stream and plays, and nobody else by name", async ({
  page,
}) => {
  await openAs(page, "member", "/history");
  await settle(page);
  const streams = section(page, "Now playing").getByRole("listitem");
  await expect(streams).toHaveCount(1);
  await expect(streams.first()).toContainText("On Apple TV");
  await expect(
    section(page, "Statistics").getByRole("heading", { level: 3 }),
  ).toHaveText(["Most watched", "By device", "How it played"]);
  await expect(page.getByLabel("Whose plays")).toHaveCount(0);
  await expect(plays(page).getByRole("listitem")).toHaveCount(25);
  await expect(page.locator("#main")).not.toContainText(
    /Robin|Kids|Alex|Sam|Unmapped/u,
  );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await violationDetails(page)).toEqual([]);
});

test("search and filters narrow the numbers and the list, and live in the address", async ({
  page,
}) => {
  await openAs(page, "owner", "/history");
  await settle(page);
  const everything = await tile(page, "Plays").innerText();

  await page
    .getByRole("searchbox", { name: "Search the watch history by title" })
    .fill("bear");
  await expect.poll(() => address(page)).toBe("/history?search=bear");
  await settle(page);
  const rows = plays(page).getByRole("listitem");
  await expect(rows.first()).toContainText("The Bear");
  expect(
    await rows.evaluateAll((items) =>
      items.every((item) => item.textContent.includes("The Bear")),
    ),
  ).toBe(true);
  await expect(tile(page, "Plays")).not.toHaveText(everything);
  await expect(section(page, "Most watched").getByRole("listitem")).toHaveCount(
    1,
  );

  // Emptying the field is a search for nothing.
  const search = page.getByRole("searchbox", {
    name: "Search the watch history by title",
  });
  await search.fill("");
  await expect.poll(() => address(page)).toBe("/history");

  // The owner narrows to one person, by name.
  await page.getByLabel("Whose plays").selectOption({ label: "Mei" });
  await expect.poll(() => address(page)).toBe(`/history?userId=${MEMBER.id}`);
  await settle(page);
  await expect(section(page, "By person").getByRole("listitem")).toHaveText([
    /^Mei/u,
  ]);
  expect(
    await rows.evaluateAll((items) =>
      items.every((item) => item.textContent.includes("Mei")),
    ),
  ).toBe(true);
  await search.fill("bear");
  await expect
    .poll(() => address(page))
    .toBe(`/history?search=bear&userId=${MEMBER.id}`);

  await page.reload();
  await settle(page);
  await expect(
    page.getByRole("searchbox", { name: "Search the watch history by title" }),
  ).toHaveValue("bear");
  await expect(page.getByLabel("Whose plays")).toHaveValue(MEMBER.id);

  // A day in the future leaves nothing, and says how to get it back.
  await page.getByLabel("From this day").fill("2099-01-01");
  await expect
    .poll(() => address(page))
    .toMatch(/&from=(?:2098-12-31|2099-01-01)T/u);
  await expect(
    page.getByRole("heading", { name: "No plays match" }),
  ).toBeVisible();
  await expect(section(page, "Statistics")).toHaveCount(0);
  expect(await violationDetails(page)).toEqual([]);
  await page
    .locator("#main")
    .getByRole("link", { name: "Clear filters" })
    .first()
    .click();
  await expect.poll(() => address(page)).toBe("/history");
  await expect(rows).toHaveCount(25);
  await expect(tile(page, "Plays")).toHaveText(everything);
  await expect(page.getByLabel("From this day")).toHaveValue("");
});

test("a household that has watched nothing is told so once", async ({
  page,
}) => {
  await inScenario(page, "new-household");
  await openAs(page, "member", "/history");
  await settle(page);
  await expect(section(page, "Now playing")).toContainText(
    "Nothing is playing right now.",
  );
  await expect(
    page.getByRole("heading", { name: "Nothing watched yet" }),
  ).toBeVisible();
  await expect(page.locator("#main")).toContainText(
    "Plays appear here once you watch something in Plex.",
  );
  await expect(section(page, "Statistics")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open the library" }),
  ).toHaveAttribute("href", "/library");
  expect(await violationDetails(page)).toEqual([]);
});

test("each part loads in its own room and fails on its own", async ({
  page,
}) => {
  const held: Route[] = [];
  await page.route(HISTORY_READS, (route) => {
    held.push(route);
  });
  // The statistics fail while everything else answers.
  await page.route(STATISTICS_READS, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal", message: "Internal error" },
      }),
    }),
  );
  // Plex has not answered lately, so Media does not guess what is playing.
  await page.route(NOW_PLAYING_READS, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        NowPlayingSchema.parse({
          observedAt: "2026-11-20T18:30:00.000Z",
          stale: true,
          items: [],
        }),
      ),
    }),
  );
  await openAs(page, "owner", "/history");
  await expect(section(page, "Plays").getByRole("status")).toContainText(
    "Loading plays",
  );
  await expect(section(page, "Now playing")).toContainText(
    "Media cannot see what is playing right now. It last looked",
  );
  await expect(section(page, "Statistics").getByRole("alert")).toContainText(
    "The statistics did not load",
  );

  await page.unroute(HISTORY_READS);
  await Promise.all(held.map(async (route) => route.fallback()));
  await expect(plays(page).getByRole("listitem")).toHaveCount(25);
  expect(await violationDetails(page)).toEqual([]);

  await page.unroute(STATISTICS_READS);
  await section(page, "Statistics")
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(tile(page, "Plays")).toHaveText(/^[\d,]+$/u);
});
