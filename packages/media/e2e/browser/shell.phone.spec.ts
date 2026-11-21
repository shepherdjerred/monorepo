import { expect, test } from "@playwright/test";
import { openAs, violationDetails } from "./support.ts";

/*
 * Navigation on a phone: the tab bar and the More sheet. Only the mobile
 * project runs this file (`playwright.config.ts`).
 */

test("a phone has four tabs and a More sheet with the rest", async ({
  page,
}) => {
  await openAs(page, "owner", "/discover");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Discover",
    "Library",
    "My requests",
    "Calendar",
  ]);
  await tabs.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/u);
  await expect(tabs.locator("[aria-current]")).toHaveText("Library");

  const more = tabs.getByRole("button", { name: "More" });
  const sheet = page.getByRole("dialog", { name: "More" });
  await more.click();
  await expect(sheet.getByRole("link")).toHaveText([
    "Watch history",
    "Leaving soon",
    "Removed",
    "Manage",
  ]);

  // Escape closes the sheet and focus returns to More.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();

  // So does a press on the backdrop, above the sheet.
  await more.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(195, 80);
  await expect(sheet).toBeHidden();

  // Following a link closes it, and More stands for the page inside it.
  await more.click();
  await sheet.getByRole("link", { name: "Watch history" }).click();
  await expect(page).toHaveURL(/\/history$/u);
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Watch history" }),
  ).toBeFocused();
  await expect(more).toHaveAttribute("aria-current", "true");
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

test("a member's More sheet has no Manage", async ({ page }) => {
  await openAs(page, "member", "/library");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "More" }).getByRole("link"),
  ).toHaveText(["Watch history", "Leaving soon", "Removed"]);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    test("the open More sheet is accessible", async ({ page }) => {
      await openAs(page, "owner", "/manage/quality");
      await page.getByRole("button", { name: "More", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
      expect(await violationDetails(page)).toEqual([]);
    });
  });
}
