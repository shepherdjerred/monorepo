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

  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
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

test("redirects every pre-Diátaxis route", async ({ page }) => {
  const redirects: Record<string, string> = {
    "/birmel/": "/explanation/birmel/",
    "/homelab/releases/": "/explanation/homelab/release-safety/",
    "/how-this-wiki-works/": "/explanation/how-this-wiki-works/",
    "/pr-fleet-controller/": "/explanation/pr-fleet-authority-boundary/",
    "/temporal/": "/explanation/temporal/overview/",
    "/temporal/schedules/": "/reference/temporal-schedules/",
    "/temporal/workflows/": "/reference/temporal-workflows/",
  };

  for (const [from, to] of Object.entries(redirects)) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to}$`));
  }
});

test("includes wiki routes in the sitemap", async ({ request }) => {
  const response = await request.get("/sitemap-0.xml");
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain("https://wiki.sjer.red/reference/temporal-workflows/");
});
