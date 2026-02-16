import { test, expect } from "@playwright/test";

test("home page screenshot matches", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot();
});

test("links screenshot matches", async ({ page }) => {
  await page.goto("/links/");
  await expect(page).toHaveScreenshot();
});

test("georgia tech screenshot matches", async ({ page }) => {
  await page.goto("/gatech/");
  await expect(page).toHaveScreenshot();
});

test("blog list screenshot matches", async ({ page }) => {
  await page.goto("/blog/");
  await expect(page).toHaveScreenshot();
});

test("shiki til screenshot matches", async ({ page }) => {
  await page.goto("/blog/2024-07-01/");
  await expect(page).toHaveScreenshot();
});

test("groovy til screenshot matches", async ({ page }) => {
  await page.goto("/blog/2024-05-24/");
  await expect(page).toHaveScreenshot();
});

test("software testing blog post screenshot matches", async ({ page }) => {
  await page.goto("/blog/2023/software-testing/");
  await expect(page).toHaveScreenshot();
});

test("screen time blog post screenshot matches", async ({ page }) => {
  await page.goto("/blog/2023/screen-time/");
  await expect(page).toHaveScreenshot();
});

test("leetcode screenshot matches", async ({ page }) => {
  await page.goto("/leetcode/");
  await expect(page).toHaveScreenshot();
});

test("sudoku solver leetcode screenshot matches", async ({ page }) => {
  await page.goto("/leetcode/hard/sudoku_solver/");
  await expect(page).toHaveScreenshot();
});

test("404 matches", async ({ page }) => {
  await page.goto("/does-not-exist/");
  await expect(page).toHaveScreenshot();
});
