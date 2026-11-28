import { expect, test } from "@playwright/test";
import { z } from "zod";
import { DeploymentSchema } from "#shared/contract.ts";
import {
  api,
  expectAccessible,
  expectNoHorizontalOverflow,
  expectNoViolations,
  usesNavDrawer,
} from "./helpers.ts";

const PAGES = [
  "/",
  "/?q=nfd",
  "/pipelines",
  "/pipelines/scout-for-lol",
  "/pipelines/arcade/executions",
  "/environments/scout-for-lol/prod",
  "/environments/gitops/tofu:openai",
  "/deployments",
  "/approvals",
  "/artifacts",
  "/activity",
  "/deployments?service=No+such+service",
  "/artifacts?service=nfd",
  "/deployments/not-a-uuid",
  "/commits/zzzz",
];

for (const scheme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} meets WCAG 2.2 AA in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, path);
    });
  }

  test(`deployment awaiting approval meets WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const [deployment] = await api(
      page,
      "/api/v1/approvals",
      z.array(DeploymentSchema),
    );
    if (deployment === undefined)
      throw new Error("Awaiting-approval deployment fixture required");
    await expectAccessible(page, `/deployments/${deployment.id}`);
  });
}

test("reduced motion stops animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pipelines/arcade");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.document.getAnimations().length),
  ).toBe(0);
});

test("console shell renders sidebar or mobile drawer, app switcher, and theme persistence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  if (usesNavDrawer(page)) {
    const topbar = page.getByRole("banner");
    await expect(topbar).toBeVisible();
    const switcher = topbar.getByRole("button", {
      name: /^Delivery.*switch app$/u,
    });
    await switcher.click();
    const menu = page.getByRole("menu");
    await expect(
      menu.getByRole("menuitem", { name: "Hub", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Flags", exact: true }),
    ).toHaveAttribute("href", "https://flags.tailnet-1a49.ts.net");
    await expect(
      menu.getByRole("menuitem", { name: "Go links", exact: true }),
    ).toHaveAttribute("href", "https://go.tailnet-1a49.ts.net");
    await expect(
      menu.getByRole("menuitem", { name: "Delivery", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    // Closed, the drawer is not mounted so there is no hidden Main nav landmark.
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    const open = topbar.getByRole("button", { name: "Open navigation" });
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => drawer.evaluate((element) => element.getAnimations().length))
      .toBe(0);
    await expectNoViolations(page, "mobile navigation drawer");

    const themeBtn = drawer.getByRole("button", { name: /^Theme: /u });
    await expect(themeBtn).toHaveAccessibleName("Theme: system");
    await themeBtn.click();
    await expect(themeBtn).toHaveAccessibleName("Theme: light");
    await themeBtn.click();
    await expect(themeBtn).toHaveAccessibleName("Theme: dark");
    expect(
      await page.evaluate(() =>
        globalThis.localStorage.getItem("delivery-theme"),
      ),
    ).toBe("dark");

    await drawer.getByRole("link", { name: "Pipelines" }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/pipelines$/u);
  } else {
    const sidebar = page.getByRole("complementary", { name: "Delivery" });
    await expect(sidebar).toBeVisible();
    const sideBox = await sidebar.boundingBox();
    expect(sideBox).not.toBeNull();
    if (sideBox !== null) {
      expect(Math.abs(sideBox.width - 228)).toBeLessThanOrEqual(1);
    }

    // Group labels stay paragraphs so they do not pollute the heading outline.
    await expect(sidebar.getByRole("heading")).toHaveCount(0);

    const switcher = sidebar.getByRole("button", {
      name: /^Delivery.*switch app$/u,
    });
    await switcher.click();
    const menu = page.getByRole("menu");
    await expect(
      menu.getByRole("menuitem", { name: "Hub", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Delivery", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expectNoViolations(page, "app switcher menu");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();

    const themeBtn = sidebar.getByRole("button", { name: /^Theme: /u });
    await expect(themeBtn).toHaveAccessibleName("Theme: system");
    await themeBtn.click();
    await expect(themeBtn).toHaveAccessibleName("Theme: light");
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.dataset["theme"],
      ),
    ).toBe("light");
    await themeBtn.click();
    await expect(themeBtn).toHaveAccessibleName("Theme: dark");
    expect(
      await page.evaluate(
        () => globalThis.document.documentElement.dataset["theme"],
      ),
    ).toBe("dark");
  }

  // Reloading preserves html[data-theme="dark"] synchronously via index.html bootstrap.
  await page.reload();
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.dataset["theme"],
    ),
  ).toBe("dark");
  await expectNoViolations(page, "dark theme reload");
  await expectNoHorizontalOverflow(page);
});
