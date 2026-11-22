import { expect } from "@playwright/test";
import { localToday } from "#client/calendar/dates.ts";
import { horizontalOverflow, openSettled, settle, test } from "./support.ts";

test("Week shows seven days across a year boundary and keeps its date and filters in the address", async ({
  page,
}, testInfo) => {
  const requestedRanges: URLSearchParams[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/calendar") {
      requestedRanges.push(url.searchParams);
    }
  });
  const day = (date: string) =>
    testInfo.project.name === "desktop"
      ? page.locator(`td[data-date="${date}"]`)
      : page.locator(`section[aria-labelledby="day-${date}"]`);
  const days =
    testInfo.project.name === "desktop"
      ? page.locator("td[data-date]")
      : page.locator('section[aria-labelledby^="day-"]');
  const week = page.getByRole("link", { name: "Week", exact: true });

  await openSettled(
    page,
    "member",
    "/calendar?kind=episode&status=missing&view=week&week=2025-12-28",
  );
  await expect(week).toHaveAttribute("aria-current", "true");
  await expect(days).toHaveCount(7);
  await expect(day("2025-12-28")).toBeVisible();
  await expect(day("2026-01-03")).toBeVisible();
  await expect
    .poll(() =>
      requestedRanges.some(
        (params) =>
          params.get("from") === "2025-12-28" &&
          params.get("to") === "2026-01-03" &&
          params.get("kind") === "episode" &&
          params.get("status") === "missing",
      ),
    )
    .toBe(true);
  expect(await horizontalOverflow(page)).toBe(0);

  await page.getByRole("link", { name: /^Next week, /u }).click();
  await settle(page);
  await expect(day("2026-01-04")).toBeVisible();
  await expect(day("2026-01-10")).toBeVisible();
  await expect(page).toHaveURL(
    /[?&]kind=episode&status=missing&view=week&week=2026-01-04$/u,
  );

  await page.goBack();
  await expect(day("2025-12-28")).toBeVisible();
  await page.reload();
  await expect(day("2026-01-03")).toBeVisible();

  await page.getByLabel("Go to a date").fill("2026-01-14");
  await settle(page);
  await expect(day("2026-01-11")).toBeVisible();
  await expect(day("2026-01-17")).toBeVisible();
  await expect(page.getByLabel("Go to a date")).toHaveValue("2026-01-14");

  await page.getByRole("link", { name: "Today", exact: true }).click();
  await settle(page);
  await expect(week).toHaveAttribute("aria-current", "true");
  await expect(day(localToday())).toBeVisible();
});
