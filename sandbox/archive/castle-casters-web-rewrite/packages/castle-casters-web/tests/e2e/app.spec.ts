import { expect, test } from "@playwright/test";

test("renders the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Castle Casters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();
});
