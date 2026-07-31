import { expect, test } from "@playwright/test";

test("renders the human-first home page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Understand the system." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { exact: true, name: "How this wiki works" }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("renders an accessible Mermaid diagram", async ({ page }) => {
  await page.goto("/how-this-wiki-works/");

  await expect(page.locator(".mermaid svg")).toBeVisible();
  await expect(page.locator(".mermaid svg title")).toContainText(
    "Wiki publishing flow",
  );
});

test("marks and down-ranks working material", async ({ page }) => {
  await page.goto("/working/plans/");

  await expect(
    page.getByText("Working material —", { exact: false }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,follow",
  );
  await expect(page.locator('[data-pagefind-weight="0.25"]')).toBeVisible();
});

test("does not publish unapproved working material", async ({ request }) => {
  const response = await request.get(
    "/working/archive/completed/homekit-secure-video/",
  );

  expect(response.status()).toBe(404);
});

test("keeps working routes out of the sitemap", async ({ request }) => {
  const response = await request.get("/sitemap-0.xml");
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain("https://wiki.sjer.red/how-this-wiki-works/");
  expect(body).not.toContain("/working/");
});
