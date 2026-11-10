import { expect, test } from "@playwright/test";
import {
  createIssue,
  recordCalls,
  scratchTeam,
  seedLongList,
  toastSaying,
} from "./data-helpers.ts";

test("a long list is windowed, pages in on scroll and keeps its place", async ({
  page,
  request,
}, info) => {
  test.setTimeout(120_000);
  const total = await seedLongList(request);
  expect(total).toBeLessThan(300);
  const calls = recordCalls(page);
  await page.goto(`/issues?team=${scratchTeam}&sort=created`);
  const list = page.getByRole("list", { name: "Issues" });
  const rows = list.getByRole("listitem");
  await expect(rows.first()).toBeVisible();
  // One page is loaded and only a window of it is in the document.
  const heading = page.getByRole("heading", { name: /All issues/u });
  await expect(heading).toContainText("100+");
  expect(await rows.count()).toBeLessThan(60);
  await expect(rows.first()).toHaveAttribute("aria-posinset", "1");
  await expect(rows.first()).toHaveAttribute("aria-setsize", "-1");

  // Scrolling to the end pages the rest in.
  await expect(async () => {
    await page.evaluate(() => {
      globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight);
    });
    await expect(heading).toContainText(String(total), { timeout: 1000 });
  }).toPass();
  await expect(heading).not.toContainText("+");
  await page.evaluate(() => {
    globalThis.scrollTo(0, globalThis.document.documentElement.scrollHeight);
  });
  expect(await rows.count()).toBeLessThan(60);
  await expect(rows.last()).toHaveAttribute("aria-posinset", String(total));
  await expect(rows.last()).toHaveAttribute("aria-setsize", String(total));
  const listCalls = calls.filter((call) => call.includes("issues.list"));
  expect(listCalls.length).toBeGreaterThanOrEqual(3);
  expect(listCalls.every((call) => call.includes('"limit":100'))).toBe(true);
  expect(listCalls.filter((call) => call.includes('"cursor"'))).toHaveLength(2);

  // Back from a full issue page returns to the same place in the list.
  await page.evaluate(() => {
    globalThis.scrollTo(0, 150 * 48);
  });
  await expect
    .poll(() => page.evaluate(() => globalThis.scrollY))
    .toBe(150 * 48);
  // A row well inside the viewport, so clicking it does not scroll the page.
  const rowInView = () =>
    page.evaluate(
      () =>
        [
          ...globalThis.document.querySelectorAll(
            'ul[aria-label="Issues"] > li',
          ),
        ]
          .find((row) => {
            const { top } = row.getBoundingClientRect();
            return top > 200 && top < globalThis.innerHeight - 200;
          })
          ?.getAttribute("aria-posinset") ?? null,
    );
  await expect.poll(rowInView).not.toBeNull();
  const position = await rowInView();
  if (position === null) throw new Error("No row is inside the viewport");
  expect(Number(position)).toBeGreaterThan(100);
  const target = list.locator(`li[aria-posinset="${position}"]`);
  const before = await page.evaluate(() => globalThis.scrollY);
  await target.getByRole("link").first().click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full issue", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    list.locator(`li[aria-posinset="${position}"]`),
  ).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => globalThis.scrollY))
    .toBeGreaterThan(before - 4);
  expect(await page.evaluate(() => globalThis.scrollY)).toBeLessThan(
    before + 4,
  );

  // A hard reload fetches as many pages again and lands on the same rows.
  await page.reload();
  // Reloading again at once, while those pages are still arriving, must
  // not settle for however far the first reload had got.
  await expect(rows.first()).toBeVisible();
  await page.reload();
  await expect(
    list.locator(`li[aria-posinset="${position}"]`),
  ).toBeInViewport();
  await expect(heading).toContainText(String(total));
  await expect
    .poll(() => page.evaluate(() => globalThis.scrollY))
    .toBeGreaterThan(before - 4);

  if (info.project.name === "mobile") {
    return;
  }
  // J walks past the first page: the list scrolls to rows it had not rendered.
  await page.goto(`/issues?team=${scratchTeam}&sort=created`);
  await expect(rows.first()).toBeVisible();
  const focused = page.locator("a[data-issue-row]:focus");
  await page.keyboard.press("Tab");
  for (let step = 1; step <= 104; step += 1) {
    if (step === 101) {
      // Reaching the end of the first page has paged the second one in.
      await expect(heading).toContainText("200+");
    }
    await page.keyboard.press("j");
    await expect(list.locator("li", { has: focused })).toHaveAttribute(
      "aria-posinset",
      String(step),
    );
  }
  await expect(focused).toBeInViewport();
  await page.keyboard.press("k");
  await expect(list.locator("li", { has: focused })).toHaveAttribute(
    "aria-posinset",
    "103",
  );
  // The focused row stays mounted, and reachable, when scrolled far away.
  await page.evaluate(() => {
    globalThis.scrollTo(0, 0);
  });
  await expect(rows.first()).toHaveAttribute("aria-posinset", "1");
  await expect(focused).toHaveCount(1);
});

test("the app pages its lists and an edit refetches only what it touched", async ({
  page,
  request,
}, info) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Targeted refetch ${info.project.name} ${String(Date.now())}`,
  });
  const calls = recordCalls(page);
  await page.goto("/issues");
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await page.goto("/board");
  await expect(page.locator(".board-card").first()).toBeVisible();
  await page.goto("/actors/human%3Ajerred");
  await expect(
    page.getByRole("heading", { name: "Created issues", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(identifier, "u") }).first(),
  ).toBeVisible();
  await page.goto(`/issues?team=${scratchTeam}&peek=${identifier}`);
  const peek = page.getByRole("dialog");
  await expect(peek.getByLabel("Status", { exact: true })).toHaveValue(
    "Triage",
  );
  expect(calls.filter((call) => call.includes('"limit":"all"'))).toEqual([]);
  expect(calls.some((call) => call.includes("issues.list"))).toBe(true);

  calls.length = 0;
  const refetched = page.waitForResponse(
    (response) =>
      response.url().includes("issues.list") &&
      response.request().method() === "GET",
  );
  await peek.locator("#property-priority").selectOption("Urgent");
  await refetched;
  await expect(toastSaying(page, `${identifier} priority set`)).toBeVisible();
  await expect
    .poll(() => calls.filter((call) => call.includes("issues.byIdentifier")))
    .not.toEqual([]);
  expect(calls.filter((call) => call.includes("meta.bootstrap"))).toEqual([]);
  expect(calls.filter((call) => call.includes("issues.update"))).toHaveLength(
    1,
  );
});
