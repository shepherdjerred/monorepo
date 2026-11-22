import { expect, type Page, type Route } from "@playwright/test";
import {
  dayLabel,
  localToday,
  monthLabel,
  monthOf,
  shiftMonth,
} from "#client/calendar/dates.ts";
import { CalendarPageSchema } from "#shared/household/calendar.ts";
import { BUSY_DAY } from "#testing/fixture-api/fixtures/calendar.ts";
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
 * The calendar: a month as an agenda or a month grid, its filters and
 * navigation in the address, the whole range read by following the cursor,
 * and dates that stay on their day wherever the viewer is. Runs at both
 * viewports; what only a wide or only a narrow screen shows is in
 * `calendar.desktop.spec.ts` and `calendar.phone.spec.ts`.
 */

const LOCALE = "en-US";
const TODAY = localToday();
const THIS_MONTH = monthOf(TODAY);
const NEXT_MONTH = shiftMonth(THIS_MONTH, 1);
const BUSY = `${THIS_MONTH}-${String(BUSY_DAY).padStart(2, "0")}`;
const CALENDAR_READS = /\/api\/v1\/calendar\?/u;

const monthHeading = (page: Page, month: string) =>
  page.getByRole("heading", { level: 2, name: monthLabel(month, LOCALE) });
/** A day's group in the agenda; today's is also named "Today". */
const agendaDay = (page: Page, date: string) =>
  page.getByRole("region", {
    name: new RegExp(`^${dayLabel(date, LOCALE)}( Today)?$`, "u"),
  });
const undated = (page: Page) =>
  page.getByRole("region", { name: "Date not announced" });

for (const persona of ["member", "owner"] as const) {
  test.describe(`as the ${persona}`, () => {
    test("the agenda lists the month's days, each release with its poster, title page and state", async ({
      page,
    }) => {
      await openAs(page, persona, "/calendar?view=agenda");
      await settle(page);
      await expect(monthHeading(page, THIS_MONTH)).toBeVisible();

      // Several releases on one day share that day's group.
      const busy = agendaDay(page, BUSY);
      const rows = busy.getByRole("listitem");
      await expect(rows).toHaveCount(5);
      await expect(rows.getByRole("link")).toHaveText([
        "Frieren: Beyond Journey's End",
        "Parasite",
        "Silo",
        "Spirited Away",
        "The Social Network",
      ]);
      for (const link of await rows.getByRole("link").all()) {
        await expect(link).toHaveAttribute("href", /^\/media\/[\da-f-]+$/u);
      }
      await expect(rows.nth(0)).toContainText(
        "Season 2, episode 7: The Hero's Party",
      );
      await expect(rows.nth(1)).toContainText("Disc release");
      await expect(rows.nth(3)).toContainText("Digital release");
      await expect(rows.nth(4)).toContainText("In cinemas");
      await expect(rows.nth(4)).toContainText("Not found yet");
      const poster = rows.nth(1).locator("img");
      await expect(poster).toHaveAttribute("loading", "lazy");
      await expect(poster).toHaveAttribute(
        "srcset",
        /\/api\/v1\/artwork\/w185\//u,
      );

      // Today is in the list whether or not anything is out.
      await expect(agendaDay(page, TODAY)).toContainText("Today");

      // No date is not a date: those releases are in no day's group.
      await expect(undated(page).getByRole("listitem")).toHaveCount(2);
      await expect(undated(page).getByRole("link")).toHaveText([
        "Anatomy of a Fall",
        "The Holdovers",
      ]);
      await expect(
        page.locator("section[aria-labelledby^='day-']").filter({
          hasText: /Anatomy of a Fall|The Holdovers/u,
        }),
      ).toHaveCount(0);

      // No member sees a contract value, and nothing asks to load more.
      await expect(page.locator("#main")).not.toContainText(
        /theatrical|physical|wanted|quarantined|importing|unknown/iu,
      );
      await expect(page.getByRole("button", { name: /more/iu })).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await violationDetails(page)).toEqual([]);
    });

    test("the month grid names each day and what is on it, and marks today", async ({
      page,
    }) => {
      await openAs(page, persona, "/calendar?view=month");
      await settle(page);
      const grid = page.getByRole("grid", {
        name: monthLabel(THIS_MONTH, LOCALE),
      });
      await expect(grid.getByRole("columnheader")).toHaveCount(7);
      expect((await grid.getByRole("gridcell").count()) % 7).toBe(0);
      await expect(
        grid.getByRole("gridcell", {
          name: `${dayLabel(BUSY, LOCALE)}${BUSY === TODAY ? ", today" : ""}, 5 releases`,
        }),
      ).toHaveAttribute("data-date", BUSY);
      const today = grid.locator('[aria-current="date"]');
      await expect(today).toHaveCount(1);
      await expect(today).toHaveAttribute("data-date", TODAY);
      await expect(undated(page).getByRole("listitem")).toHaveCount(2);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await violationDetails(page)).toEqual([]);
    });
  });
}

test("the filters live in the address and survive a reload", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar?view=agenda");
  await settle(page);
  await page.getByLabel("Kind of release").selectOption("Disc releases");
  await expect
    .poll(() => address(page))
    .toBe("/calendar?kind=physical&view=agenda");
  await expect(agendaDay(page, BUSY).getByRole("link")).toHaveText([
    "Parasite",
  ]);
  await expect(undated(page).getByRole("link")).toHaveText([
    "Anatomy of a Fall",
  ]);

  await page.getByLabel("Ready to watch or not").selectOption("Ready to watch");
  await expect
    .poll(() => address(page))
    .toBe("/calendar?kind=physical&status=available&view=agenda");
  await page.reload();
  await settle(page);
  await expect(page.getByLabel("Kind of release")).toHaveValue("physical");
  await expect(page.getByLabel("Ready to watch or not")).toHaveValue(
    "available",
  );
  // The two discs that can be watched, and no undated release among them.
  await expect(
    page.getByRole("list", { name: /^Releases / }).getByRole("link"),
  ).toHaveText(["Dune: Part Two", "Parasite"]);
  await expect(undated(page)).toHaveCount(0);

  // A month in which nothing fits says so, and offers the way out.
  const later = shiftMonth(THIS_MONTH, 6);
  await page.goto(`/calendar?month=${later}&kind=digital&status=available`);
  await expect(
    page.getByRole("heading", { name: "No releases match" }),
  ).toBeVisible();
  await expect(page.locator("#main")).toContainText(
    `Nothing in ${monthLabel(later, LOCALE)} fits these filters.`,
  );
  expect(await violationDetails(page)).toEqual([]);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect.poll(() => address(page)).toBe(`/calendar?month=${later}`);
  await expect(undated(page).getByRole("listitem")).toHaveCount(2);
});

test("previous, next and today move a month at a time, with the month in the address", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar?view=agenda");
  await settle(page);
  const next = page.getByRole("link", {
    name: `Next month, ${monthLabel(NEXT_MONTH, LOCALE)}`,
  });
  await next.click();
  await expect
    .poll(() => address(page))
    .toBe(`/calendar?month=${NEXT_MONTH}&view=agenda`);
  await expect(monthHeading(page, NEXT_MONTH)).toBeVisible();
  await expect(agendaDay(page, `${NEXT_MONTH}-05`)).toContainText(
    "Oppenheimer",
  );
  // The control that was used keeps the focus.
  await expect(page.getByRole("link", { name: /^Next month, / })).toBeFocused();

  await page.getByRole("link", { name: /^Previous month, / }).click();
  await page.getByRole("link", { name: /^Previous month, / }).click();
  const previous = shiftMonth(THIS_MONTH, -1);
  await expect
    .poll(() => address(page))
    .toBe(`/calendar?month=${previous}&view=agenda`);
  await expect(agendaDay(page, `${previous}-22`)).toContainText("Poor Things");

  // Back undoes a step; Today returns to the month the viewer is in.
  await page.goBack();
  await expect.poll(() => address(page)).toBe("/calendar?view=agenda");
  await page.goForward();
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect
    .poll(() => page.url())
    .toMatch(new RegExp(String.raw`/calendar\?view=agenda#day-${TODAY}$`, "u"));
  await expect(monthHeading(page, THIS_MONTH)).toBeVisible();
  await expect(agendaDay(page, TODAY)).toBeInViewport();
});

test("the date field goes to the month a date is in and marks the day", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar?view=agenda");
  await settle(page);
  const day = `${NEXT_MONTH}-14`;
  await page.getByLabel("Go to a date").fill(day);
  await expect
    .poll(() => page.url())
    .toMatch(
      new RegExp(
        String.raw`/calendar\?month=${NEXT_MONTH}&view=agenda#day-${day}$`,
        "u",
      ),
    );
  await expect(agendaDay(page, day)).toHaveAttribute("data-marked", "true");
  await expect(agendaDay(page, day)).toContainText("The Social Network");
  await expect(page.getByLabel("Go to a date")).toHaveValue(day);

  // The same day in the month grid.
  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect(
    page.getByRole("gridcell", {
      name: new RegExp(`^${dayLabel(day, LOCALE)},`, "u"),
    }),
  ).toHaveAttribute("data-marked", "true");
});

test("the whole range is read by following the cursor, with nothing to press", async ({
  page,
}) => {
  // The API is asked for seven releases at a time, so the month takes
  // several answers.
  const cursors: (string | null)[] = [];
  await page.route(CALENDAR_READS, async (route) => {
    const url = new URL(route.request().url());
    cursors.push(url.searchParams.get("cursor"));
    url.searchParams.set("limit", "7");
    await route.continue({ url: url.toString() });
  });
  await openAs(page, "member", "/calendar?view=agenda");
  await settle(page);
  expect(cursors.length).toBeGreaterThan(3);
  expect(cursors[0]).toBeNull();
  expect(cursors.slice(1).every((cursor) => cursor !== null)).toBe(true);
  expect(new Set(cursors).size).toBe(cursors.length);
  // The last day with releases, and the undated ones that sort after it.
  await expect(agendaDay(page, `${THIS_MONTH}-27`)).toContainText("Silo");
  await expect(agendaDay(page, BUSY).getByRole("listitem")).toHaveCount(5);
  await expect(undated(page).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /more/iu })).toHaveCount(0);
});

test("the calendar takes the same room while it loads, then says when it could not", async ({
  page,
}) => {
  const held: Route[] = [];
  await page.route(CALENDAR_READS, (route) => {
    held.push(route);
  });
  await openAs(page, "member", "/calendar?view=month");
  // The month's own days are drawn while it loads; only the label is read.
  await expect(page.getByRole("status")).toContainText("Loading the calendar");
  const loading = await page.locator("#main table").boundingBox();
  await page.unroute(CALENDAR_READS);
  await Promise.all(held.map(async (route) => route.fallback()));
  await settle(page);
  const loaded = await page.getByRole("grid").boundingBox();
  expect(loaded?.y).toBe(loading?.y);
  expect(loaded?.width).toBe(loading?.width);

  // A failed read is an error state with a way to try again.
  await page.route(CALENDAR_READS, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal", message: "Internal error" },
      }),
    }),
  );
  await page.getByRole("link", { name: /^Next month, / }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The calendar did not load",
  );
  expect(await violationDetails(page)).toEqual([]);
  await page.unroute(CALENDAR_READS);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a household with nothing on the calendar is pointed at Discover", async ({
  page,
}) => {
  await inScenario(page, "new-household");
  await openAs(page, "member", "/calendar");
  await settle(page);
  await expect(
    page.getByRole("heading", {
      name: `Nothing on the calendar for ${monthLabel(THIS_MONTH, LOCALE)}`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Find something to watch" }),
  ).toHaveAttribute("href", "/discover");
  expect(await violationDetails(page)).toEqual([]);
});

/*
 * A release date is a civil date. In a zone far behind UTC a date read as a
 * moment slips to the day before; far ahead, a careless "today" slips the
 * other way. March 8, 2026 is also the day United States clocks go forward.
 */
for (const zone of [
  "Pacific/Pago_Pago",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
]) {
  test.describe(`with the viewer in ${zone}`, () => {
    test.use({ timezoneId: zone });

    test("a release stays on the date it was announced for", async ({
      page,
    }) => {
      const answer = CalendarPageSchema.parse({
        events: ["2026-03-01", "2026-03-08", "2026-03-31"].map((date) => ({
          id: `stub:${date}`,
          mediaId: "stub-media",
          rootMediaId: "stub-root",
          artwork: { posterPath: null, backdropPath: null },
          title: `Out on ${date}`,
          seriesTitle: null,
          seasonNumber: null,
          episodeNumber: null,
          kind: "digital",
          region: "US",
          date,
          precision: "day",
          availability: "wanted",
          observedAt: null,
        })),
        nextCursor: null,
      });
      await page.route(CALENDAR_READS, (route) =>
        route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(answer),
        }),
      );
      await openAs(page, "member", "/calendar?month=2026-03&view=month");
      await settle(page);
      const grid = page.getByRole("grid", { name: "March 2026" });
      for (const [date, name] of [
        ["2026-03-01", "Sunday, March 1, 1 release"],
        ["2026-03-08", "Sunday, March 8, 1 release"],
        ["2026-03-31", "Tuesday, March 31, 1 release"],
        ["2026-03-07", "Saturday, March 7, no releases"],
        ["2026-03-09", "Monday, March 9, no releases"],
        ["2026-03-30", "Monday, March 30, no releases"],
      ] as const) {
        await expect(
          grid.getByRole("gridcell", { name, exact: true }),
        ).toHaveAttribute("data-date", date);
      }
      // The grid asked for the weeks around March, to the day.
      await page.getByRole("link", { name: "Agenda", exact: true }).click();
      for (const date of ["2026-03-01", "2026-03-08", "2026-03-31"]) {
        await expect(agendaDay(page, date)).toContainText(`Out on ${date}`);
      }
      await expect(
        page.locator("section[aria-labelledby^='day-']"),
      ).toHaveCount(3);
    });
  });
}
