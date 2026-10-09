import { expect, test } from "@playwright/test";

test("routes the home page by reader need", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Understand the system." }),
  ).toBeVisible();

  for (const heading of [
    "Start here",
    "Solve a specific problem",
    "Look something up",
    "Understand how it fits together",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("groups the sidebar by Diátaxis kind", async ({ page }) => {
  await page.goto("/reference/temporal-workflows/");

  const sidebar = page.getByRole("navigation", { name: "Main" });
  for (const group of ["Tutorials", "How-to guides", "Reference", "Concepts"]) {
    await expect(sidebar.getByText(group, { exact: true })).toBeVisible();
  }
});

test("renders an accessible Mermaid diagram", async ({ page }) => {
  await page.goto("/explanation/how-this-wiki-works/");

  await expect(page.locator(".mermaid svg")).toBeVisible();
  await expect(page.locator(".mermaid svg title")).toContainText(
    "Wiki publishing flow",
  );
});

test("follows a legacy redirect in the browser", async ({ page }) => {
  await page.goto("/temporal/workflows/");
  await expect(page).toHaveURL(/\/reference\/temporal-workflows\/$/u);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Temporal workflow inventory",
    }),
  ).toBeVisible();
});
