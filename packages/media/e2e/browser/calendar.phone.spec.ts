import { expect } from "@playwright/test";
import {
  dayLabel,
  localToday,
  monthLabel,
  monthOf,
} from "#client/calendar/dates.ts";
import { BUSY_DAY } from "#testing/fixture-api/fixtures/calendar.ts";
import {
  address,
  openAs,
  horizontalOverflow,
  settle,
  test,
  violationDetails,
} from "./support.ts";

/*
 * The calendar on a phone: the agenda by default, and a month grid whose
 * squares have room only for how many releases a day has.
 */

const LOCALE = "en-US";
const THIS_MONTH = monthOf(localToday());
const BUSY = `${THIS_MONTH}-${String(BUSY_DAY).padStart(2, "0")}`;

test("the calendar opens as an agenda, and the month grid counts each day's releases", async ({
  page,
}) => {
  await openAs(page, "member", "/calendar");
  await settle(page);
  await expect(page.getByRole("grid")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Agenda", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page
      .locator(`section[aria-labelledby="day-${BUSY}"]`)
      .getByRole("listitem"),
  ).toHaveCount(5);

  await page.getByRole("link", { name: "Month", exact: true }).click();
  await expect.poll(() => address(page)).toBe("/calendar?view=month");
  const grid = page.getByRole("grid", { name: monthLabel(THIS_MONTH, LOCALE) });
  await expect(grid).toBeVisible();
  // The whole week fits the screen; nothing scrolls sideways.
  const width = page.viewportSize()?.width ?? 0;
  const box = await grid.boundingBox();
  if (box === null) throw new Error("The grid has no box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await horizontalOverflow(page)).toBe(0);

  // A square shows a number, not titles it has no room for.
  const busy = grid.locator(`td[data-date="${BUSY}"]`);
  await expect(busy.getByRole("listitem")).toHaveCount(0);
  const tally = busy.getByRole("link", {
    name: `5 releases on ${dayLabel(BUSY, LOCALE)}`,
  });
  await expect(tally).toHaveText("5");
  const target = await tally.boundingBox();
  if (target === null) throw new Error("The count has no box");
  expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(24);
  expect(await violationDetails(page)).toEqual([]);

  // The number opens that day in the agenda.
  await tally.click();
  await expect
    .poll(() => page.url())
    .toMatch(new RegExp(String.raw`/calendar\?view=agenda#day-${BUSY}$`, "u"));
  const group = page.locator(`section[aria-labelledby="day-${BUSY}"]`);
  await expect(group).toHaveAttribute("data-marked", "true");
  await expect(group).toBeInViewport();
});
