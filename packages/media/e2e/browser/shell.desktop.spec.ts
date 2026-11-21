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
    "Discover",
    "Library",
    "My requests",
    "Calendar",
    "Watch history",
    "Leaving soon",
    "Removed",
    "Manage",
  ]);
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

test("a member's sidebar has no Manage", async ({ page }) => {
  await openAs(page, "member", "/library");
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Manage" }),
  ).toHaveCount(0);
});
