import { expect, test } from "@playwright/test";

// Keyboard navigation is desktop-only; the mobile project ignores *.desktop.spec.ts.
test("the keyboard moves a real focus through the list and steps back out of an issue", async ({
  page,
}) => {
  await page.goto("/issues?sort=created");
  const rows = page.locator("a[data-issue-row]");
  await expect(rows.first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(0)).not.toHaveAttribute("aria-current", "true");
  await rows.nth(4).hover();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("k");
  await expect(rows.nth(0)).toBeFocused();
  const identifier = await rows.nth(0).getAttribute("data-issue-row");
  if (identifier === null) throw new Error("The focused row has no issue");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`peek=${identifier}$`, "u"));
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(rows.nth(0)).toBeFocused();

  await page.keyboard.press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full issue", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/issues/${identifier}$`, "u"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Escape steps back through this tab's history instead of resetting the list.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(
    new RegExp(String.raw`/issues\?sort=created&peek=${identifier}$`, "u"),
  );
  await expect(page.getByRole("dialog")).toContainText(identifier);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues\?sort=created$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Escape on an issue opened directly returns to the issue list", async ({
  page,
}) => {
  await page.goto("/issues/AI-1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/issues$/u);
});
