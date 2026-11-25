import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { DESKTOP, horizontalOverflow, PHONE, violations } from "./helpers.ts";

const PRIMARY = { name: "Primary navigation" };

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
          - link "Cluster":
            - /url: /cluster
        - listitem:
          - link "Services":
            - /url: /services
        - listitem:
          - link "Monorepo":
            - /url: /monorepo
        - listitem:
          - link "Flow":
            - /url: /flow
        - listitem:
          - link "Renovate":
            - /url: /renovate
        - listitem:
          - link "Product":
            - /url: /product
        - listitem:
          - link "AI":
            - /url: /ai
        - listitem:
          - link "Maintenance":
            - /url: /maintenance
        - listitem:
          - link "Review":
            - /url: /review
        - listitem:
          - link "Reports":
            - /url: /reports
        - listitem:
          - link "Traces":
            - /url: /traces
      - paragraph: Alerts
      - list "Alerts":
        - listitem:
          - link "Active":
            - /url: /alerts
        - listitem:
          - link "House":
            - /url: /house
        - listitem:
          - link "History":
            - /url: /history
        - listitem:
          - link "System":
            - /url: /system
      - paragraph: The Storm
      - list "The Storm":
        - listitem:
          - link "Overview":
            - /url: /the-storm
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
  await expect(links).toHaveCount(18);
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

test("the sidebar sits beside an inset panel, and the document scrolls", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");
  await expect(page.locator(".loading-state")).toHaveCount(0);

  const sidebar = page.getByRole("complementary", { name: "Hub" });
  const side = await sidebar.boundingBox();
  if (side === null) throw new Error("the sidebar is not rendered");
  expect(Math.abs(side.width - 228)).toBeLessThanOrEqual(1);

  // The inset panel is the element that holds the page's content container.
  const panel = page.locator("#content").locator("xpath=..");
  const geometry = await panel.evaluate((element) => {
    const style = globalThis.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      borderWidth: Number.parseFloat(style.borderLeftWidth),
      borderStyle: style.borderLeftStyle,
      borderColor: style.borderLeftColor,
      background: style.backgroundColor,
      pageBackground: globalThis.getComputedStyle(globalThis.document.body)
        .backgroundColor,
      overflowY: style.overflowY,
      scrollHeight: globalThis.document.documentElement.scrollHeight,
      innerHeight: globalThis.innerHeight,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(228);
  expect(geometry.borderWidth).toBeGreaterThanOrEqual(1);
  expect(geometry.borderStyle).toBe("solid");
  expect(geometry.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(geometry.borderColor).not.toBe(geometry.background);
  expect(geometry.background).not.toBe(geometry.pageBackground);
  // The panel never becomes a scroll container: page-height budgets measure
  // the document, so a long page must lengthen the document instead.
  expect(["auto", "scroll"]).not.toContain(geometry.overflowY);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.innerHeight);
  const panelBox = await panel.boundingBox();
  if (panelBox === null) throw new Error("the panel is not rendered");
  await page.mouse.move(panelBox.x + 200, 300);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => page.evaluate(() => globalThis.scrollY))
    .toBeGreaterThan(0);
  // The sidebar stays put while the document scrolls.
  await expect(
    sidebar.getByRole("button", { name: /^Theme: / }),
  ).toBeInViewport({ ratio: 1 });
});

test("the app switcher opens a menu of the other consoles", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");
  const trigger = page
    .getByRole("complementary", { name: "Hub" })
    .getByRole("button", { name: /^Hub.*switch app$/u });
  await expect(trigger).toBeInViewport({ ratio: 1 });
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Go links" }),
  ).toHaveAttribute("href", "https://go.tailnet-1a49.ts.net");
  await expect(menu.getByRole("menuitem", { name: "Flags" })).toHaveAttribute(
    "href",
    "https://flags.tailnet-1a49.ts.net",
  );
  await expect(
    menu.getByRole("menuitem", { name: "Hub", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await violations(new AxeBuilder({ page }))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
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
  await expect(drawer.getByRole("link")).toHaveCount(18);
  await expect(drawer.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // More Tab presses than the drawer has stops: focus wraps inside it.
  for (let press = 0; press < 23; press += 1) {
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
    for (const path of ["/", "/alerts", "/house", "/history", "/promotion"]) {
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
    await expect(drawer.getByRole("link")).toHaveCount(18);
    // Let the slide-in finish so contrast is measured on the settled drawer.
    await expect(drawer).not.toHaveAttribute("data-starting-style", "");
    expect(await violations(new AxeBuilder({ page }))).toEqual([]);
  });

  test(`/house and /history have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    for (const path of ["/house", "/history?scope=house"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      expect(await violations(new AxeBuilder({ page })), path).toEqual([]);
    }
  });
}
