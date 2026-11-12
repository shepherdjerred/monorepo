import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  scratchTeam,
  toastSaying,
  removeScratchIssues,
  scratchTag,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

const subIssues = (page: Page) =>
  page.getByRole("list", { name: "Sub-issues" }).getByRole("listitem");

test("sub-issues added inline count towards their parent's progress", async ({
  page,
}) => {
  const tag = scratchTag();
  const parent = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Parent ${tag}`,
  });
  await page.goto(`/issues/${parent}`);
  const add = page.getByRole("textbox", {
    name: `Add sub-issue to ${parent}`,
  });
  await add.fill(`First child ${tag}`);
  await add.press("Enter");
  // The field empties and keeps focus for the next one.
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await add.fill(`Second child ${tag}`);
  await add.press("Enter");
  await expect(subIssues(page)).toHaveCount(2);
  const progress = page.locator(".sub-issue-progress");
  await expect(progress).toContainText("0/2");
  const first = subIssues(page).filter({ hasText: "First child" });
  // It has its identifier once the server answers.
  await expect(first.locator(".identifier")).toHaveText(/^SJ-\d+$/u);
  const status = first.locator("select, button").first();
  const child = (await first.locator(".identifier").textContent()) ?? "";
  if (
    await status.evaluate((element) => element instanceof HTMLSelectElement)
  ) {
    await status.selectOption("Done");
  } else {
    await status.click();
    await page.getByRole("option", { name: "Done" }).click();
  }
  await expect(toastSaying(page, `${child} status set to Done`)).toBeVisible();
  await expect(progress).toContainText("1/2");
  await expect(
    page.getByRole("progressbar", { name: `Sub-issues of ${parent} done` }),
  ).toHaveAttribute("aria-valuetext", "1 of 2 done");
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await expect(
    page.locator(`li[data-row-issue="${parent}"] .sub-issue-badge`),
  ).toContainText("1/2");
  // A sub-issue's row names its parent.
  await expect(
    page.locator(`li[data-row-issue="${child}"] .row-parent`),
  ).toContainText(parent);
});

test("the Parent field searches for a parent; a cycle is refused with the server's reason", async ({
  page,
}) => {
  const tag = scratchTag();
  const top = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Top ${tag}`,
  });
  const middle = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Middle ${tag}`,
  });
  await page.goto(`/issues/${middle}`);
  await page.locator("#property-parent").click();
  const search = page.getByRole("combobox", { name: `Parent of ${middle}` });
  await expect(search).toBeFocused();
  await search.fill(top);
  await page.getByRole("option", { name: new RegExp(top, "u") }).click();
  await expect(toastSaying(page, `${middle} moved under ${top}`)).toBeVisible();
  const crumb = page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: top });
  await expect(crumb).toBeVisible();
  // The top issue's grandchild cannot become its parent.
  const bottom = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Bottom ${tag}`,
    parentIdentifier: middle,
  });
  await crumb.click();
  await expect(page).toHaveURL(new RegExp(`/issues/${top}$`, "u"));
  await expect(subIssues(page)).toHaveCount(1);
  await page.locator("#property-parent").click();
  await page.getByRole("combobox", { name: `Parent of ${top}` }).fill(bottom);
  await page.getByRole("option", { name: new RegExp(bottom, "u") }).click();
  await expect(
    toastSaying(
      page,
      "An issue cannot become a sub-issue of its own descendant",
    ),
  ).toBeVisible();
  // The refused parent is taken back.
  await expect(page.locator("#property-parent")).toContainText("Set parent");
});

test("hiding sub-issues from Display filters them on the server and keeps it in the URL", async ({
  page,
}) => {
  const tag = scratchTag();
  const parent = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Display parent ${tag}`,
  });
  const child = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Display child ${tag}`,
    parentIdentifier: parent,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  const row = (identifier: string) =>
    page.locator(`li[data-row-issue="${identifier}"]`);
  await expect(row(child)).toBeVisible();
  const listed = page.waitForRequest(
    (request) =>
      request.url().includes("issues.list") &&
      decodeURIComponent(request.url()).includes('"hasParent":false'),
  );
  await page.getByRole("button", { name: "Display" }).click();
  const toggle = page.getByRole("switch", { name: "Show sub-issues" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await listed;
  await expect(page).toHaveURL(/subissues=hide/u);
  await expect(row(child)).toHaveCount(0);
  await expect(row(parent)).toBeVisible();
  await page.reload();
  await expect(row(parent)).toBeVisible();
  await expect(row(child)).toHaveCount(0);
});
