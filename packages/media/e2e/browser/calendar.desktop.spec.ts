import { expect, type Page } from "@playwright/test";
import {
  dayLabel,
  localToday,
  monthLabel,
  monthOf,
} from "#client/calendar/dates.ts";
import { BUSY_DAY } from "#testing/fixture-api/fixtures/calendar.ts";
import { address, openAs, settle, test } from "./support.ts";

/*
 * The calendar on a wide screen: the month grid by default, squares with
 * words in them, and the keyboard's way around the grid.
 */

const LOCALE = "en-US";
const TODAY = localToday();
const THIS_MONTH = monthOf(TODAY);
const BUSY = `${THIS_MONTH}-${String(BUSY_DAY).padStart(2, "0")}`;

const day = (page: Page, date: string) =>
  page.locator(`td[data-date="${date}"]`);

/** The date of the day focus is on, or null when focus is on no day. */
async function focusedDay(page: Page): Promise<string | null> {
  const focused = page.locator("td:focus");
  return (await focused.count()) === 0
    ? null
    : focused.getAttribute("data-date");
}

test("the calendar opens as a month grid, and a full day says how many more it has", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar");
  await settle(page);
  await expect(
    page.getByRole("grid", { name: monthLabel(THIS_MONTH, LOCALE) }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Month", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  // Five releases: two are listed, the rest are one link to that day.
  const busy = day(page, BUSY);
  await expect(busy.getByRole("listitem")).toHaveCount(2);
  const first = busy.getByRole("link", {
    name: "Frieren: Beyond Journey's End Season 2, episode 7: The Hero's Party.",
  });
  await expect(first).toHaveAttribute("href", /^\/media\/[\da-f-]+$/u);
  await expect(first.locator("img")).toHaveAttribute(
    "srcset",
    /\/api\/v1\/artwork\/w185\//u,
  );
  const box = await first.locator("img").boundingBox();
  if (box === null) throw new Error("The thumbnail has no box");
  expect(box.height / box.width).toBeCloseTo(1.5, 1);
  await busy
    .getByRole("link", { name: `3 more on ${dayLabel(BUSY, LOCALE)}` })
    .click();
  await expect
    .poll(() => page.url())
    .toMatch(new RegExp(String.raw`/calendar\?view=agenda#day-${BUSY}$`, "u"));
  const group = page.locator(`section[aria-labelledby="day-${BUSY}"]`);
  await expect(group).toHaveAttribute("data-marked", "true");
  await expect(group.getByRole("listitem")).toHaveCount(5);
  await expect(group).toBeInViewport();
});

test("Week keeps keyboard focus when moving between weeks", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar?view=week&week=2025-12-28");
  await settle(page);
  await expect(page.locator("td[tabindex='0']")).toHaveCount(1);
  await day(page, "2026-01-03").focus();
  await page.keyboard.press("ArrowDown");
  await expect(day(page, "2026-01-03")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(day(page, "2026-01-04")).toBeFocused();
  await expect(page).toHaveURL(/view=week&week=2026-01-04$/u);
  await page.keyboard.press("PageDown");
  await expect(day(page, "2026-01-11")).toBeFocused();
  await expect(page.locator("td[tabindex='0']")).toHaveCount(1);
});

test("the arrow keys move between days, and past the month's end into the next", async ({
  page,
}) => {
  // March 2026 starts on a Sunday and holds a clock change.
  await openAs(page, "member", "/calendar?month=2026-03&view=month");
  await settle(page);
  // The grid is one Tab stop: the 1st, since today is in another month.
  await expect(page.locator("td[tabindex='0']")).toHaveCount(1);
  await day(page, "2026-03-01").focus();

  for (const [key, expected] of [
    ["ArrowRight", "2026-03-02"],
    ["ArrowDown", "2026-03-09"],
    ["End", "2026-03-14"],
    ["Home", "2026-03-08"],
    ["ArrowLeft", "2026-03-07"],
    ["ArrowRight", "2026-03-08"],
    ["ArrowUp", "2026-03-01"],
    ["PageDown", "2026-04-01"],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(async () => focusedDay(page), key).toBe(expected);
  }
  await expect
    .poll(() => address(page))
    .toBe("/calendar?month=2026-04&view=month");
  await expect(page.getByRole("grid", { name: "April 2026" })).toBeVisible();

  // Left from the 1st is the last day of the month before.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => focusedDay(page)).toBe("2026-03-31");
  await expect
    .poll(() => address(page))
    .toBe("/calendar?month=2026-03&view=month");
  await page.keyboard.press("PageUp");
  await expect.poll(async () => focusedDay(page)).toBe("2026-02-28");
  await expect(page.getByRole("grid", { name: "February 2026" })).toBeVisible();
  // Still one Tab stop, on the day focus is on.
  await expect(page.locator("td[tabindex='0']")).toHaveAttribute(
    "data-date",
    "2026-02-28",
  );
  // A key the grid has no use for is left alone.
  await page.keyboard.press("a");
  await expect.poll(async () => focusedDay(page)).toBe("2026-02-28");
});

test("Tab walks the releases of the day focus is on, then leaves the grid", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar?view=month");
  await settle(page);
  const busy = day(page, BUSY);
  await busy.focus();
  // Only this day's links are Tab stops.
  const stops = page.locator("#main table a[tabindex='0']");
  await expect(stops).toHaveCount(4);
  expect(
    await stops.evaluateAll(
      (links) => links.filter((link) => link.checkVisibility()).length,
    ),
  ).toBe(3);

  await page.keyboard.press("Tab");
  await expect(busy.getByRole("link").nth(0)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(busy.getByRole("link").nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(busy.getByRole("link", { name: /^3 more on / })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#main table :focus")).toHaveCount(0);

  // Shift+Tab comes back to the day, and a release opens its title page.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(busy.getByRole("link").nth(1)).toBeFocused();
  await expect(busy.getByRole("link").nth(1)).toContainText("Parasite");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Parasite" }),
  ).toBeVisible();
});
