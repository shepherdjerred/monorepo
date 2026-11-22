import { expect } from "@playwright/test";
import { openAs, test, violationDetails } from "./support.ts";

/*
 * Navigation on a phone: the tab bar. Only the mobile project runs this file
 * (`playwright.config.ts`).
 */

test("a member's tab bar is the four destinations", async ({ page }) => {
  await openAs(page, "member", "/discover");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Discover",
    "Library",
    "Calendar",
    "History",
  ]);
  await tabs.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/u);
  await expect(tabs.locator("[aria-current]")).toHaveText("Library");
  await expect(
    page.getByRole("heading", { level: 1, name: "Library" }),
  ).toBeFocused();

  // A view inside the Library keeps the Library tab marked.
  await page
    .getByRole("navigation", { name: "Library views" })
    .getByRole("link", { name: /Leaving soon/u })
    .click();
  await expect(page).toHaveURL(/\/library\/leaving$/u);
  await expect(tabs.locator("[aria-current]")).toHaveText("Library");
});

test("the owner's tab bar adds Manage, with nothing behind a second step", async ({
  page,
}) => {
  await openAs(page, "owner", "/discover");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Discover",
    "Library",
    "Calendar",
    "History",
    "Manage",
  ]);
  await expect(tabs.getByRole("button")).toHaveCount(0);
  await tabs.getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/manage\/household$/u);
  await expect(tabs.locator("[aria-current]")).toHaveText("Manage");

  // Five tabs fit a phone: none is clipped and the page does not scroll
  // sideways.
  for (const tab of await tabs.getByRole("link").all()) {
    const box = await tab.boundingBox();
    if (box === null) throw new Error("A tab has no box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(
      await tab.evaluate((link) => link.scrollWidth <= link.clientWidth),
    ).toBe(true);
  }
});

test("the tab bar never covers the end of a page", async ({ page }) => {
  await openAs(page, "owner", "/library");
  await page.waitForLoadState("networkidle");
  await page.locator("html").evaluate((root) => {
    root.scrollTop = root.scrollHeight;
  });
  const tabBar = await page
    .getByRole("navigation", { name: "Main" })
    .boundingBox();
  const last = await page.locator("#main > :last-child").boundingBox();
  if (tabBar === null || last === null) throw new Error("Nothing to measure");
  expect(last.y + last.height).toBeLessThanOrEqual(tabBar.y);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    test("the owner's tab bar is accessible", async ({ page }) => {
      await openAs(page, "owner", "/manage/quality");
      expect(await violationDetails(page)).toEqual([]);
    });
  });
}
