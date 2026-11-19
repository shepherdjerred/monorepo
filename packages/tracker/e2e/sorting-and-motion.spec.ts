import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  removeScratchIssues,
  scratchTag,
  scratchTeam,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

async function listedIdentifiers(page: Page): Promise<string[]> {
  return page
    .locator('ul[aria-label="Issues"] li[data-row-issue]')
    .evaluateAll((elements) =>
      elements.map(
        (el) => (el instanceof HTMLElement ? el.dataset["rowIssue"] : "") ?? "",
      ),
    );
}

async function boardIdentifiers(page: Page): Promise<string[]> {
  return page
    .locator(".board-card[data-row-issue]")
    .evaluateAll((elements) =>
      elements.map(
        (el) => (el instanceof HTMLElement ? el.dataset["rowIssue"] : "") ?? "",
      ),
    );
}

test("toolbar SortControl orders list rows and board cards in both directions while keeping unset values last", async ({
  page,
  request,
}) => {
  const tag = scratchTag();
  const bravo = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Bravo ${tag}`,
    effort: "xl",
    priority: 3,
  });
  const alpha = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Alpha ${tag}`,
    effort: "xs",
    priority: 1,
  });
  const charlie = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Charlie ${tag}`,
    priority: 0,
  });

  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  await expect(page.locator(`li[data-row-issue="${alpha}"]`)).toBeVisible();

  await page.locator("#sort-picker").selectOption("effort");
  await expect(page).toHaveURL(/sort=effort/u);
  await expect(page).not.toHaveURL(/dir=/u);
  await expect
    .poll(() => listedIdentifiers(page))
    .toEqual([alpha, bravo, charlie]);

  await page.locator("#sort-direction").click();
  await expect(page).toHaveURL(/sort=effort/u);
  await expect(page).toHaveURL(/dir=desc/u);
  await expect
    .poll(() => listedIdentifiers(page))
    .toEqual([bravo, alpha, charlie]);

  await page.locator("#sort-picker").selectOption("title");
  await expect
    .poll(() => listedIdentifiers(page))
    .toEqual([alpha, bravo, charlie]);

  await page.locator("#sort-direction").click();
  await expect
    .poll(() => listedIdentifiers(page))
    .toEqual([charlie, bravo, alpha]);

  await page.goto(`/board?team=${scratchTeam}&q=${tag}`);
  await expect(
    page.locator(`.board-card[data-row-issue="${alpha}"]`),
  ).toBeVisible();
  await expect(page.locator("#sort-picker")).toHaveValue("board");

  await page.locator("#sort-picker").selectOption("title");
  await expect
    .poll(() => boardIdentifiers(page))
    .toEqual([alpha, bravo, charlie]);

  await page.locator("#sort-direction").click();
  await expect
    .poll(() => boardIdentifiers(page))
    .toEqual([charlie, bravo, alpha]);
});

test("Projects and Actors pages expose search and sort controls", async ({
  page,
}) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByLabel("Search projects")).toBeVisible();
  const projectsSort = page.locator("#projects-sort");
  await expect(projectsSort).toHaveValue("name-asc");
  await projectsSort.selectOption("name-desc");
  await expect(projectsSort).toHaveValue("name-desc");
  await expect(page).toHaveURL(/sort=name-desc/u);

  await page.goto("/actors");
  await expect(page.getByRole("heading", { name: "Actors" })).toBeVisible();
  await expect(page.getByLabel("Search actors")).toBeVisible();
  const actorsSort = page.locator("#actors-sort");
  await expect(actorsSort).toHaveValue("last-seen");
  await actorsSort.selectOption("name");
  await expect(actorsSort).toHaveValue("name");
  await expect(page).toHaveURL(/actorSort=name/u);
});

test("rows do not shift under pointer press and Settings → Feedback → Motion disables animations across reload", async ({
  page,
  request,
}) => {
  const tag = scratchTag();
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Calm target ${tag}`,
  });

  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  const row = page.locator(`li[data-row-issue="${identifier}"]`);
  await expect(row).toBeVisible();
  const before = await row.boundingBox();
  if (before === null) throw new Error("Row is not visible");

  await page.mouse.move(before.x + 24, before.y + before.height / 2);
  await page.mouse.down();
  const pressed = await row.boundingBox();
  await page.mouse.up();
  if (pressed === null) throw new Error("Row disappeared during press");
  expect(Math.abs(pressed.x - before.x)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(pressed.y - before.y)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(pressed.width - before.width)).toBeLessThanOrEqual(0.01);
  expect(Math.abs(pressed.height - before.height)).toBeLessThanOrEqual(0.01);

  await page.goto("/settings");
  const motionSwitch = page.getByRole("switch", { name: "Motion" });
  await expect(motionSwitch).toBeChecked();
  await motionSwitch.click();
  await expect(motionSwitch).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  expect(
    await page.evaluate(() =>
      globalThis.localStorage.getItem("tracker.feedback.motion"),
    ),
  ).toBe("off");

  await page.goto("/issues");
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await page
    .getByRole("button", { name: "New issue", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Issue title", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.document.getAnimations().length),
  ).toBe(0);
});
