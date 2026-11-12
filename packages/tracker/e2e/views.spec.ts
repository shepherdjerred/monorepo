import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  createView,
  removeViews,
  scratchTeam,
  toastSaying,
  removeScratchIssues,
  scratchTag,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

/** Where the saved views are listed: the sidebar, or the phone's More sheet. */
async function viewsList(page: Page, mobile: boolean) {
  if (mobile) {
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "More" })
      .click();
    return page.getByRole("dialog", { name: "More" });
  }
  return page.locator(".sidebar");
}

test("a saved view keeps its filters, lists in the sidebar and opens them again", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const tag = scratchTag();
  const name = `Urgent ${tag}`;
  try {
    const identifier = await createIssue(page.request, {
      teamKey: scratchTeam,
      title: `Saved view ${tag}`,
      priority: 1,
    });
    await page.goto(`/issues?team=${scratchTeam}&q=${tag}&priority=1`);
    await page.locator("#save-view").click();
    const dialog = page.getByRole("dialog", { name: "Save view" });
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("radio", { name: "Rocket" }).check();
    await dialog.getByRole("button", { name: "Save view" }).click();
    await expect(toastSaying(page, `View “${name}” saved`)).toBeVisible();
    await expect(page).toHaveURL(/saved=/u);
    await expect(page.locator(".view-heading h2")).toContainText(name);
    // Saved as it is shown, nothing is left to save.
    await expect(page.locator("#save-view")).toHaveCount(0);

    await page.reload();
    await page.goto(`/issues?team=${scratchTeam}`);
    const list = await viewsList(page, mobile);
    await list.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`q=${tag}`, "u"));
    await expect(page).toHaveURL(/priority=1/u);
    await expect(page.locator(".view-heading h2")).toContainText(name);
    await expect(
      page.locator(`li[data-row-issue="${identifier}"]`),
    ).toBeVisible();
    const opened = await viewsList(page, mobile);
    await expect(opened.getByRole("link", { name })).toHaveAttribute(
      "aria-current",
      "page",
    );
  } finally {
    await removeViews(page.request, [name]);
  }
});

test("views reorder from their menu and delete after asking", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const tag = scratchTag();
  const first = `First ${tag}`;
  const second = `Second ${tag}`;
  try {
    await createView(page.request, {
      name: first,
      params: { teamKey: scratchTeam, priority: "2" },
      teamKey: scratchTeam,
    });
    await createView(page.request, {
      name: second,
      params: { teamKey: scratchTeam, priority: "3" },
      teamKey: scratchTeam,
    });
    const order = async () => {
      const list = await viewsList(page, mobile);
      const names = await list.locator(".view-nav-item > a").allTextContents();
      if (mobile) {
        await page.keyboard.press("Escape");
      }
      return names.filter((text) => text.includes(tag));
    };
    await page.goto(`/issues?team=${scratchTeam}`);
    await expect.poll(order).toEqual([first, second]);
    const list = await viewsList(page, mobile);
    await list
      .getByRole("button", { name: `Actions for view ${first}` })
      .click();
    await page.getByRole("menuitem", { name: "Move down" }).click();
    await expect(
      list.locator(".view-nav-item > a").filter({ hasText: tag }),
    ).toHaveText([second, first]);
    if (mobile) {
      await page.keyboard.press("Escape");
    }
    await page.reload();
    await expect.poll(order).toEqual([second, first]);

    const again = await viewsList(page, mobile);
    await again
      .getByRole("button", { name: `Actions for view ${second}` })
      .click();
    await page.getByRole("menuitem", { name: "Delete view…" }).click();
    await page
      .getByRole("dialog", { name: `Delete view “${second}”?` })
      .getByRole("button", { name: "Delete view" })
      .click();
    await expect(toastSaying(page, `View “${second}” deleted`)).toBeVisible();
    if (mobile) {
      await page.keyboard.press("Escape");
    }
    await page.reload();
    await expect.poll(order).toEqual([first]);
  } finally {
    await removeViews(page.request, [first, second]);
  }
});
