import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  removeIssue,
  scratchTeam,
  uniqueTag,
} from "./data-helpers.ts";
import {
  afterPacing,
  clearFeedback,
  expectCues,
  played,
  recordFeedback,
} from "./delight-helpers.ts";

function nothing() {
  // Replaced once the gate exists.
}

/** A request the test lets through only when `release` is called. */
function hold(page: Page, procedure: string) {
  let release: () => void = nothing;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  void page.route(
    (url) =>
      url.pathname.startsWith("/trpc/") && url.pathname.includes(procedure),
    async (route) => {
      await gate;
      await route.continue();
    },
  );
  return () => {
    release();
  };
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (found === null) {
    throw new Error(`${selector} is not on screen`);
  }
  return found;
}

test("skeletons hold the heading and first row where the data lands", async ({
  page,
}) => {
  const releaseWorkspace = hold(page, "meta.bootstrap");
  const releaseList = hold(page, "issues.list");
  await page.goto("/issues");
  const skeletonRow = ".skeleton .issue-list > li";
  await expect(page.locator(skeletonRow).first()).toBeVisible();
  await expect(page.getByText("Loading issues…")).toBeAttached();
  const headingBefore = await box(page, ".view-heading");
  const rowBefore = await box(page, skeletonRow);
  releaseWorkspace();
  await expect(page.getByRole("button", { name: /^Filter/u })).toBeVisible();
  // The real toolbar replaced its placeholder without moving the list.
  const rowMiddle = await box(page, skeletonRow);
  expect(Math.abs(rowMiddle.y - rowBefore.y)).toBeLessThanOrEqual(1);
  releaseList();
  const firstRow = page
    .getByRole("list", { name: "Issues" })
    .locator("li")
    .first();
  await expect(firstRow).toBeVisible();
  const rowAfter = await firstRow.boundingBox();
  const headingAfter = await box(page, ".view-heading");
  expect(rowAfter).not.toBeNull();
  expect(Math.abs((rowAfter?.y ?? 0) - rowBefore.y)).toBeLessThanOrEqual(1);
  expect(
    Math.abs((rowAfter?.height ?? 0) - rowBefore.height),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(headingAfter.y - headingBefore.y)).toBeLessThanOrEqual(1);
  expect(
    Math.abs(headingAfter.height - headingBefore.height),
  ).toBeLessThanOrEqual(1);
});

test("opening the full issue is a view transition; opening the peek is not", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(globalThis, "__viewTransitions", { value: calls });
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      calls.push(location.pathname + location.search);
      return original(update);
    };
  });
  const transitions = () =>
    page.evaluate(() => {
      const calls: unknown = Reflect.get(globalThis, "__viewTransitions");
      return Array.isArray(calls) ? calls.length : -1;
    });
  await page.goto("/issues");
  const first = page.locator("a[data-issue-row]").first();
  const identifier = (await first.getAttribute("data-issue-row")) ?? "";
  await first.click();
  await expect(page).toHaveURL(new RegExp(`peek=${identifier}`, "u"));
  await expect(page.getByRole("dialog", { name: identifier })).toBeVisible();
  expect(await transitions()).toBe(0);
  await page.getByRole("link", { name: "Open full issue" }).click();
  await expect(page).toHaveURL(new RegExp(`/issues/${identifier}$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await transitions()).toBe(1);
  // The page names its title so the morph has somewhere to land.
  expect(
    await page
      .locator(".issue-detail:not(.is-peek) .detail-title")
      .evaluate((title) => getComputedStyle(title).viewTransitionName),
  ).toBe("issue-title");
});

test("a dragged card is carried by a lifted copy over a dashed slot", async ({
  page,
}) => {
  await page.goto("/board");
  const card = page.locator(".board-card").first();
  const handle = card.locator(".drag-handle");
  const start = await handle.boundingBox();
  if (start === null) {
    throw new Error("No card to drag");
  }
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 80, { steps: 8 });
  const lifted = page.locator(".lifted-card");
  await expect(lifted).toBeVisible();
  await expect(card).toHaveClass(/dragging/u);
  await expect(card).toHaveAttribute("inert", "");
  await expect
    .poll(() => lifted.evaluate((element) => getComputedStyle(element).rotate))
    .toBe("2deg");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(lifted).toHaveCount(0);
  await expect(card).not.toHaveClass(/dragging/u);
});

test("a bulk status change over three issues plays one cue", async ({
  page,
}) => {
  await recordFeedback(page);
  const tag = uniqueTag();
  const identifiers: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    identifiers.push(
      await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Delight bulk ${tag} ${String(index + 1)}`,
      }),
    );
  }
  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  for (const identifier of identifiers) {
    await page.locator(`li[data-row-issue="${identifier}"] .row-check`).click();
  }
  await expect(
    page.getByRole("region", { name: "Selected issues" }),
  ).toContainText("3 selected");
  // Selecting buzzes lightly and makes no sound.
  await afterPacing(page);
  const selecting = await played(page);
  expect(selecting.cues).toEqual([]);
  await clearFeedback(page);
  await page.locator("#bulk-state").click();
  await page.getByRole("option", { name: "In progress" }).click();
  for (const identifier of identifiers) {
    await expect(
      page.locator(`[data-picker="state"][data-issue="${identifier}"]`),
    ).toHaveValue("In progress");
  }
  await expectCues(page, ["status"]);
  await afterPacing(page);
  const after = await played(page);
  expect(after.cues).toEqual(["status"]);
  expect(after.vibrations).toHaveLength(1);
  for (const identifier of identifiers) {
    await removeIssue(page.request, identifier);
  }
});
