import { expect } from "@playwright/test";
import { openAs, test } from "./support.ts";

/*
 * Navigation on a screen wide enough for the sidebar. Only the desktop
 * project runs this file (`playwright.config.ts`).
 */

test("the sidebar moves between pages and marks the current one", async ({
  page,
}) => {
  await openAs(page, "owner", "/discover");
  const sidebar = page.getByRole("navigation", { name: "Main" });
  await expect(sidebar.getByRole("link")).toHaveText([
    "Home",
    "Discover",
    "Library",
    "Calendar",
    "History",
    "Manage",
  ]);
  // The sidebar has Manage, so the account panel does not repeat it here.
  await page.getByRole("button", { name: "Account" }).click();
  await expect(
    page.getByRole("link", { name: "Recovery reviews" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Manage" })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sidebar.getByRole("link", { name: "Discover" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await sidebar.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/library$/u);
  const heading = page.getByRole("heading", { level: 1, name: "Library" });
  // Focus follows the navigation to the new page's heading.
  await expect(heading).toBeFocused();
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText("Library");

  // A page inside Manage keeps Manage marked.
  await sidebar.getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/manage\/household$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Household" }),
  ).toBeFocused();
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText("Manage");
  const manage = page.getByRole("navigation", { name: "Manage" });
  await manage.getByRole("link", { name: "Quality" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Quality" }),
  ).toBeFocused();
  await expect(manage.locator('[aria-current="page"]')).toHaveText("Quality");
});

test("the logo opens Home", async ({ page }) => {
  await openAs(page, "member", "/library");
  await page.getByRole("link", { name: "media." }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Home" }),
  ).toBeFocused();
});

test("a member's sidebar has no Manage", async ({ page }) => {
  await openAs(page, "member", "/library");
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Manage" }),
  ).toHaveCount(0);
});
