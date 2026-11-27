import { expect, test, type Page } from "@playwright/test";
import {
  agentApi,
  openFocused,
  resetAndSeed,
  sharedFixtures,
} from "./review-setup.ts";
import { expectNoAxeViolations } from "./canvas-helpers.ts";
import { publishFixture, type SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

const KEY = "artifacts.panel.collapsed.v1";

async function setCollapsed(
  page: Page,
  viewer: "board" | "focused",
  collapsed: boolean,
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(String(key), String(value));
    },
    [`${KEY}:${viewer}`, String(collapsed)],
  );
}

function toggle(page: Page) {
  return page.getByTestId("panel-toggle");
}

test.describe("floating comments panel", () => {
  test(
    "opens by default on a wide screen, toggles by button and Shift+C, and moves focus",
    { tag: "@desktop" },
    async ({ page }) => {
      await page.goto("/b/concepts");
      const panel = page.getByTestId("comments-panel");
      await expect(panel).toBeVisible();
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(toggle(page)).toHaveAttribute("aria-controls", /.+/u);

      // A floating card: not a layout column, inset from the top, right and bottom.
      const box = await panel.boundingBox();
      const viewport = page.viewportSize();
      if (box === null || viewport === null) throw new Error("no boxes");
      expect(box.width).toBeCloseTo(360, 0);
      expect(viewport.width - (box.x + box.width)).toBeCloseTo(12, 0);
      expect(box.y).toBeCloseTo(12, 0);
      expect(viewport.height - (box.y + box.height)).toBeCloseTo(12, 0);
      // The canvas underneath still uses the full width.
      const canvas = await page.getByTestId("canvas-viewport").boundingBox();
      expect(canvas?.width).toBe(viewport.width);

      await toggle(page).click();
      await expect(panel).toHaveCount(0);
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(toggle(page)).toBeFocused();

      // Keyboard: expand moves focus into the panel, collapse back to the toggle.
      await page.keyboard.press("Shift+C");
      await expect(page.getByTestId("comments-panel")).toBeFocused();
      await page.keyboard.press("Shift+C");
      await expect(toggle(page)).toBeFocused();
      // Shift+C is not comment mode.
      await expect(
        page.getByRole("button", { name: "Comment mode" }),
      ).toHaveAttribute("aria-pressed", "false");
    },
  );

  test(
    "the collapsed pill shows the open count and who is waiting",
    { tag: "@desktop" },
    async ({ page, baseURL }) => {
      await agentApi(baseURL).threads.create.mutate({
        board: "concepts",
        anchor: { type: "board", page: 0, x: 300, y: -60 },
        body: "Pill count",
      });
      await setCollapsed(page, "board", true);
      await page.goto("/b/concepts");
      const pill = toggle(page);
      await expect(pill).toContainText("1");
      await expect(pill).toHaveAttribute("aria-expanded", "false");
      await expect(pill.locator("svg")).toBeVisible();
      await expect(pill).toContainText(/Show comments, 1 open/u);
    },
  );

  test(
    "the choice persists across a reload, per viewer",
    { tag: "@desktop" },
    async ({ page }) => {
      await page.goto("/b/concepts");
      await toggle(page).click();
      await page.reload();
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
      // The focused view remembers its own.
      await openFocused(page, seeded.demo.png.artifactId);
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
      await toggle(page).click();
      await page.goto("/b/concepts");
      await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    },
  );

  test(
    "clicking a pin, or placing a comment, expands the panel on the thread",
    { tag: "@desktop" },
    async ({ page, baseURL }) => {
      const api = agentApi(baseURL);
      await api.boards.create.mutate({ slug: "pinboard", title: "Pin board" });
      const fixtures = await sharedFixtures();
      const published = await publishFixture(String(baseURL), {
        board: "pinboard",
        title: "Only frame",
        files: fixtures.htmlV1.files,
        entryPath: fixtures.htmlV1.entryPath,
      });
      const frameId = published.artifactId;
      await api.threads.create.mutate({
        board: "pinboard",
        artifactId: frameId,
        anchor: { type: "frame", x: 0.5, y: 0.5 },
        body: "Pin on frame A",
      });
      await setCollapsed(page, "board", true);
      await page.goto("/b/pinboard");
      await expect(page.getByTestId("pin")).toHaveCount(1);
      await page.getByTestId("pin").click();
      const panel = page.getByTestId("comments-panel");
      await expect(panel).toBeVisible();
      const thread = page
        .getByTestId("thread")
        .filter({ hasText: "Pin on frame A" });
      await expect(thread).toBeInViewport();
      await expect(thread).toHaveAttribute("data-selected", "true");

      // Collapse, then place a new board comment: it opens on the new thread.
      await toggle(page).click();
      await expect(panel).toHaveCount(0);
      await page.keyboard.press("c");
      const view = await page.getByTestId("canvas-viewport").boundingBox();
      if (view === null) throw new Error("no canvas");
      await page.mouse.click(view.x + 60, view.y + view.height - 120);
      const composer = page.getByTestId("placement-composer");
      await composer.getByRole("textbox").fill("A fresh one");
      await composer.getByRole("button", { name: "Comment" }).click();
      await expect(page.getByTestId("comments-panel")).toBeVisible();
      await expect(
        page.getByTestId("thread").filter({ hasText: "A fresh one" }),
      ).toBeInViewport();
    },
  );

  test(
    "fit-all with the panel open keeps every frame clear of it",
    { tag: "@desktop" },
    async ({ page, baseURL }) => {
      const api = agentApi(baseURL);
      await api.boards.create.mutate({ slug: "wide", title: "Wide" });
      const fixtures = await sharedFixtures();
      for (let at = 0; at < 6; at += 1)
        await publishFixture(String(baseURL), {
          board: "wide",
          title: `Wide ${String(at + 1)}`,
          files: fixtures.htmlV1.files,
          entryPath: fixtures.htmlV1.entryPath,
        });
      await page.goto("/b/wide");
      await page.waitForTimeout(600);
      await page.keyboard.press("1");
      await page.waitForTimeout(500);
      const panel = await page.getByTestId("comments-panel").boundingBox();
      if (panel === null) throw new Error("no panel");
      const frames = await page.getByTestId("canvas-frame").all();
      expect(frames).toHaveLength(6);
      for (const frame of frames) {
        const box = await frame.boundingBox();
        if (box === null) throw new Error("no frame box");
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x);
      }
    },
  );

  test(
    "on a phone the panel is a bottom sheet and its pill sits above the tools",
    { tag: "@phone" },
    async ({ page }) => {
      await page.goto("/b/concepts");
      // Collapsed to start with, as a pill above the toolbar.
      await expect(page.getByTestId("comments-panel")).toHaveCount(0);
      const pill = await toggle(page).boundingBox();
      const tools = await page
        .getByRole("toolbar", { name: "Canvas tools" })
        .boundingBox();
      if (pill === null || tools === null) throw new Error("no boxes");
      expect(pill.y + pill.height).toBeLessThanOrEqual(tools.y);
      await toggle(page).click();
      const sheet = await page.getByTestId("comments-panel").boundingBox();
      const viewport = page.viewportSize();
      if (sheet === null || viewport === null) throw new Error("no sheet");
      expect(sheet.width).toBeGreaterThan(viewport.width - 24);
      expect(sheet.y + sheet.height).toBeGreaterThan(viewport.height - 16);
      expect(sheet.y).toBeGreaterThan(viewport.height * 0.3);
    },
  );
});

test.describe("floating nav", () => {
  test("the canvas and the focused view have no shell bar, the inbox and outline keep it", async ({
    page,
  }) => {
    await page.goto("/b/concepts");
    await expect(page.getByTestId("floating-nav")).toBeVisible();
    await expect(page.locator("header.ar-top")).toHaveCount(0);
    await openFocused(page, seeded.demo.png.artifactId);
    await expect(page.getByTestId("floating-nav")).toBeVisible();
    await expect(page.locator("header.ar-top")).toHaveCount(0);
    await page.goto("/");
    await expect(page.locator("header.ar-top")).toHaveCount(1);
    await page.goto("/b/concepts/outline");
    await expect(page.locator("header.ar-top")).toHaveCount(1);
  });

  test("the canvas is full-bleed: the viewer starts at the top of the page", async ({
    page,
  }) => {
    await page.goto("/b/concepts");
    const canvas = await page.getByTestId("canvas-viewport").boundingBox();
    expect(canvas?.y).toBe(0);
    await openFocused(page, seeded.demo.png.artifactId);
    const pane = await page
      .getByRole("region", { name: "Artifact" })
      .boundingBox();
    expect(pane?.y).toBe(0);
  });

  test("the nav pill keeps the workspace switcher and Inbox, and the heading is the board title", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/b/concepts");
    const nav = page.getByTestId("floating-nav");
    await expect(
      page.getByRole("heading", { name: "Concepts", level: 1 }),
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: /switch app/u }),
    ).toBeVisible();
    if (isMobile) {
      // The phone keeps the mark, the title and an overflow button.
      await expect(nav.getByRole("link", { name: "Inbox" })).toBeHidden();
      await nav.getByRole("button", { name: "More" }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "List view" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(nav.getByRole("button", { name: "More" })).toBeFocused();
      await nav.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Inbox" }).click();
      await expect(page).toHaveURL(/\/$/u);
    } else {
      await nav.getByRole("link", { name: "List view" }).click();
      await expect(page).toHaveURL(/\/b\/concepts\/outline/u);
      await page.goBack();
      await nav.getByRole("link", { name: "Inbox" }).click();
      await expect(page).toHaveURL(/\/$/u);
    }
  });

  test(
    "the focused nav shows board › artifact, the version, and Open raw",
    { tag: "@desktop" },
    async ({ page }) => {
      await openFocused(page, seeded.demo.htmlV2.artifactId);
      const nav = page.getByTestId("floating-nav");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Concept A",
      );
      await expect(nav.getByRole("link", { name: "Demo board" })).toBeVisible();
      await expect(nav.getByLabel("Version")).toBeVisible();
      await expect(nav.getByRole("link", { name: "Open raw" })).toHaveAttribute(
        "target",
        "_blank",
      );
      await nav.getByLabel("Version").selectOption({ label: "v1" });
      await expect(page).toHaveURL(/v=1/u);
    },
  );

  test(
    "the app switcher menu opens with the console links and closes with Escape",
    { tag: "@desktop" },
    async ({ page }) => {
      await page.goto("/b/concepts");
      const nav = page.getByTestId("floating-nav");
      const switcher = nav.getByRole("button", { name: /switch app/u });
      await switcher.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
      await expect(switcher).toBeFocused();
    },
  );

  test(
    "the keyboard-shortcuts button opens the sheet, which lists Shift+C",
    { tag: "@desktop" },
    async ({ page }) => {
      await page.goto("/b/concepts");
      await page
        .getByTestId("floating-nav")
        .getByRole("button", { name: "Keyboard shortcuts" })
        .click();
      await expect(page.getByRole("dialog")).toContainText("Shift+C");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    },
  );

  test("the floating shell has no axe violations, expanded and collapsed", async ({
    page,
    isMobile,
  }) => {
    const check = () => expectNoAxeViolations(page, { iframes: false });
    await page.goto("/b/concepts");
    await page.waitForTimeout(800);
    await check();
    if (!isMobile) {
      await toggle(page).click();
      await check();
    }
    await openFocused(page, seeded.demo.htmlV2.artifactId);
    await page.waitForTimeout(800);
    await check();
  });
});
