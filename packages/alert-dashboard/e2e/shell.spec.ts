import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 720 };
const PRIMARY = { name: "Primary navigation" };

/**
 * How far the page scrolls sideways, and how far the page's own `<main>`
 * overflows its box. The content column is a size container, and a browser
 * may keep a container's overflow out of the document's scrollable area, so
 * the document width alone would not notice content cut off inside it.
 */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const main = globalThis.document.querySelector("main");
    return {
      document:
        globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      main: main === null ? 0 : main.scrollWidth - main.clientWidth,
    };
  });
}

async function violations(builder: AxeBuilder) {
  const results = await builder
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

test("the sidebar lists every page under its group", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.getByRole("navigation", PRIMARY)).toMatchAriaSnapshot(`
    - navigation "Primary navigation":
      - paragraph: Ops
      - list "Ops":
        - listitem:
          - link "Home":
            - /url: /
        - listitem:
          - link "Services":
            - /url: /services
        - listitem:
          - link "Flow":
            - /url: /flow
        - listitem:
          - link "AI":
            - /url: /ai
        - listitem:
          - link "Maintenance":
            - /url: /maintenance
        - listitem:
          - link "Review":
            - /url: /review
      - paragraph: Alerts
      - list "Alerts":
        - listitem:
          - link "Active":
            - /url: /alerts
        - listitem:
          - link "History":
            - /url: /history
        - listitem:
          - link "System":
            - /url: /system
      - paragraph: The Storm
      - list "The Storm":
        - listitem:
          - link "Promotion":
            - /url: /promotion
  `);
  // The group names label their lists without joining the heading outline.
  await expect(
    page.getByRole("complementary").getByRole("heading"),
  ).toHaveCount(0);
});

test("every sidebar link is on screen at 1280px without scrolling", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const nav = page.getByRole("navigation", PRIMARY);
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(10);
  for (const link of await links.all())
    await expect(link).toBeInViewport({ ratio: 1 });
  expect(
    await nav.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBeLessThanOrEqual(0);
  const sidebar = page.getByRole("complementary", { name: "Hub" });
  await expect(
    sidebar.getByRole("button", { name: "Search and commands" }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    sidebar.getByRole("button", { name: /^Theme: / }),
  ).toBeInViewport({ ratio: 1 });
});

test("the sidebar marks the current page, including its detail pages", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/history");
  const nav = page.getByRole("navigation", PRIMARY);
  await expect(nav.getByRole("link", { name: "History" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

  await page.goto("/services/scout-for-lol");
  await expect(nav.getByRole("link", { name: "Services" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
});

test("the skip link moves focus to the content without changing the URL", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/alerts");
  await expect(page.locator("main h1")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect(page.locator("#content")).toBeFocused();
  await expect(page).toHaveURL(/\/alerts$/u);
});

test("the phone drawer opens from the top bar, traps focus, and closes on Escape", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");
  // Closed, the drawer is not mounted and the sidebar is not rendered.
  await expect(page.getByRole("navigation", PRIMARY)).toHaveCount(0);

  const open = page.getByRole("button", { name: "Open navigation" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("navigation", PRIMARY)).toBeVisible();
  await expect(page.getByRole("navigation", PRIMARY)).toHaveCount(1);
  await expect(drawer.getByRole("link")).toHaveCount(10);
  await expect(drawer.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // More Tab presses than the drawer has stops: focus wraps inside it.
  for (let press = 0; press < 15; press += 1) {
    await page.keyboard.press("Tab");
    await expect(
      drawer.locator(":focus"),
      `Tab press ${String(press + 1)}`,
    ).toHaveCount(1);
  }
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await expect(page.getByRole("navigation", PRIMARY)).toHaveCount(0);
});

test("a drawer link navigates and closes the drawer", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("link", { name: "History" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/history$/u);
  await expect(page).toHaveTitle("History · Hub");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("button", { name: "Close navigation" }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/history$/u);
});

test("the drawer gives way to the sidebar and to the palette", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto("/");
  const open = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });

  await open.click();
  await expect(drawer).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("navigation", PRIMARY)).toHaveCount(1);
  await expect(page.getByRole("navigation", PRIMARY)).toBeVisible();

  await page.setViewportSize(PHONE);
  await open.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(drawer).toBeHidden();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("combobox")).toBeFocused();
});

test("promotion renders inside the shell", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/promotion");
  await expect(page).toHaveTitle("The Storm promotion · Hub");
  await expect(
    page.locator("#content main").getByRole("heading", { level: 1 }),
  ).toHaveText("Promotion");
  const nav = page.getByRole("navigation", PRIMARY);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Promotion" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The page no longer brings a header and theme button of its own.
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Theme: / })).toHaveCount(1);
});

for (const viewport of [PHONE, DESKTOP]) {
  test(`pages fit ${String(viewport.width)}px without horizontal scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const path of ["/", "/alerts", "/history", "/promotion"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      const overflow = await horizontalOverflow(page);
      expect(overflow.document, path).toBeLessThanOrEqual(0);
      expect(overflow.main, path).toBeLessThanOrEqual(0);
    }
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the shell has no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await expect(page.locator("main h1")).toHaveText("Home");
    await expect(page.locator(".loading-state")).toHaveCount(0);
    expect(await violations(new AxeBuilder({ page }))).toEqual([]);
  });

  test(`the open drawer has no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(page.locator("main h1")).toHaveText("Home");
    await expect(page.locator(".loading-state")).toHaveCount(0);
    // The closed state covers the top bar and the page beneath it.
    expect(await violations(new AxeBuilder({ page }))).toEqual([]);
    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("link")).toHaveCount(10);
    // Let the slide-in finish so contrast is measured on the settled drawer.
    await expect(drawer).not.toHaveAttribute("data-starting-style", "");
    expect(await violations(new AxeBuilder({ page }))).toEqual([]);
  });
}
