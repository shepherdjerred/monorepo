import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  createView,
  listViews,
  removeViews,
  reorderViews,
  scratchTeam,
  toastSaying,
  removeScratchIssues,
  scratchTag,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

// Keyboard paths for sub-issues, due dates and saved views; the mobile
// project ignores *.desktop.spec.ts.
const link = (page: Page, identifier: string) =>
  page.locator(`a[data-issue-row="${identifier}"]`);

test("G then 1 opens the first saved view and Alt+↓ moves it down", async ({
  page,
}) => {
  const tag = scratchTag();
  const first = `Keys first ${tag}`;
  const second = `Keys second ${tag}`;
  try {
    const one = await createView(page.request, {
      name: first,
      params: { teamKey: scratchTeam, sort: "due" },
      teamKey: scratchTeam,
    });
    const two = await createView(page.request, {
      name: second,
      params: { teamKey: scratchTeam, sort: "priority" },
      teamKey: null,
    });
    const existing = await listViews(page.request);
    const others = existing
      .map(({ id }) => id)
      .filter((id) => id !== one.id && id !== two.id);
    await reorderViews(page.request, [one.id, two.id, ...others]);
    await page.goto(`/issues?team=${scratchTeam}`);
    await expect(page.locator(`a[data-view="${one.id}"]`)).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("1");
    await expect(page).toHaveURL(new RegExp(`saved=${one.id}`, "u"));
    await expect(page).toHaveURL(/sort=due/u);
    await page.keyboard.press("?");
    await expect(
      page.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toContainText("Go to the first nine saved views");
    await page.keyboard.press("Escape");

    const view = page.locator(`a[data-view="${one.id}"]`);
    await view.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect
      .poll(async () => {
        const views = await listViews(page.request);
        return views.map(({ id }) => id).slice(0, 2);
      })
      .toEqual([two.id, one.id]);
    await expect(view).toBeFocused();
  } finally {
    await removeViews(page.request, [first, second]);
  }
});

test("Shift+O on a row opens New issue as its sub-issue", async ({ page }) => {
  const tag = scratchTag();
  const parent = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Shortcut parent ${tag}`,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await link(page, parent).focus();
  await page.keyboard.press("Shift+O");
  const dialog = page.getByRole("dialog", { name: "New issue" });
  await expect(dialog).toContainText(`Sub-issue of ${parent}`);
  await dialog
    .getByRole("textbox", { name: "Issue title" })
    .fill(`Shortcut child ${tag}`);
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(page).toHaveURL(/\/issues\/SJ-\d+$/u);
  await expect(
    page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: parent }),
  ).toBeVisible();
});

test("the palette's Set parent step searches for the parent", async ({
  page,
}) => {
  const tag = scratchTag();
  const parent = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Set parent target ${tag}`,
  });
  const child = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Palette child ${tag}`,
  });
  await page.goto(`/issues/${child}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("combobox", {
    name: "Search issues and commands",
  });
  await input.fill("Set parent");
  // An issue titled with the same words is found too; the command leads.
  await expect(
    page.getByRole("option", { name: new RegExp(parent, "u") }),
  ).toBeVisible();
  await input.press("Enter");
  const step = page.getByRole("combobox", { name: "Set parent" });
  await step.fill(parent);
  await expect(
    page.getByRole("option", { name: new RegExp(parent, "u") }),
  ).toBeVisible();
  await step.press("Enter");
  await expect(
    toastSaying(page, `${child} moved under ${parent}`),
  ).toBeVisible();
});

test("Shift+D opens the due date picker and its calendar takes the arrow keys", async ({
  page,
}) => {
  const tag = scratchTag();
  const identifier = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Calendar ${tag}`,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await link(page, identifier).focus();
  await page.keyboard.press("Shift+D");
  const picker = page.getByRole("dialog", {
    name: `Due date of ${identifier}`,
  });
  await expect(picker.getByRole("textbox")).toBeFocused();
  const today = picker.locator('td[aria-current="date"]');
  await expect(today).toHaveAttribute("tabindex", "0");
  await today.focus();
  await page.keyboard.press("ArrowRight");
  const tomorrow = picker.locator('td[tabindex="0"]');
  await expect(tomorrow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`li[data-row-issue="${identifier}"] .due-chip time`),
  ).toHaveText("Tomorrow");
});
