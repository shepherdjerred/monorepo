import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  DESKTOP,
  gotoLoadedPage,
  horizontalOverflow,
  PHONE,
  violations,
} from "./helpers.ts";

/**
 * The gallery's overlays and inputs (console-ui CU4): keyboard and focus in
 * a real browser, axe on each open overlay in both themes, and no sideways
 * overflow with one open.
 */

/**
 * Axe reads colours mid-fade as low contrast; wait for the popup and every
 * finite animation on the page (a popup's panel may be its ancestor).
 */
async function settled(popup: Locator): Promise<void> {
  await expect(popup).toBeVisible();
  await expect(popup).toHaveCSS("opacity", "1");
  // A transition cancelled by the next state rejects; settled is enough.
  await popup.page().evaluate(async () => {
    await Promise.allSettled(
      globalThis.document
        .getAnimations()
        // Loops (the connecting dot, skeleton bones) never finish.
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map(async (animation) => animation.finished),
    );
  });
}

/**
 * The gallery also holds the sandboxed email preview, whose frame cannot run
 * axe's cross-frame scripts, so axe runs in legacy mode.
 */
function legacyAxe(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).setLegacyMode(true);
}

async function openGallery(page: Page): Promise<void> {
  await gotoLoadedPage(page, "/kit");
  await expect(
    page.getByRole("heading", { name: "Overlays and inputs" }),
  ).toBeVisible();
}

const actionsMenu = (page: Page): Locator =>
  page.getByRole("menu", { name: "Actions for go/ha" });

test.describe("menus", () => {
  test("the keyboard opens, walks, nests and closes the menu", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Actions" });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = actionsMenu(page);
    await settled(menu);
    await expect(menu.getByRole("menuitem", { name: /Copy ID/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const moveTo = menu.getByRole("menuitem", { name: "Move to" });
    await expect(moveTo).toBeFocused();
    await page.keyboard.press("ArrowRight");
    const cluster = page.getByRole("menuitem", { name: "Cluster" });
    await expect(cluster).toBeFocused();
    // Escape closes only the submenu.
    await page.keyboard.press("Escape");
    await expect(cluster).toHaveCount(0);
    await expect(moveTo).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("choosing an item runs it and closes the menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Actions" }).click();
    await actionsMenu(page)
      .getByRole("menuitem", { name: /Copy ID/ })
      .click();
    await expect(actionsMenu(page)).toHaveCount(0);
    await expect(page.getByText("Copied go/ha")).toBeVisible();
  });

  test("a checkbox item toggles and keeps the menu open", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Actions" }).click();
    const item = actionsMenu(page).getByRole("menuitemcheckbox", {
      name: "Show resolved",
    });
    await expect(item).toHaveAttribute("aria-checked", "true");
    await item.click();
    await expect(item).toHaveAttribute("aria-checked", "false");
    await expect(actionsMenu(page)).toBeVisible();
  });

  test("Shift+F10 and right-click open the context menu on its target", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const target = page.getByText("go/ha: right-click");
    await target.focus();
    await page.keyboard.press("Shift+F10");
    await settled(actionsMenu(page));
    await page.keyboard.press("Escape");
    await expect(actionsMenu(page)).toHaveCount(0);
    await target.click({ button: "right" });
    await settled(actionsMenu(page));
    await page.keyboard.press("Escape");
    await expect(actionsMenu(page)).toHaveCount(0);
  });
});

test.describe("popover", () => {
  test("opens anchored, closes on Escape and returns focus", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Display" });
    await trigger.click();
    const popover = page.getByRole("dialog", { name: "Display" });
    await settled(popover);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await settled(popover);
    // A click outside closes it too.
    await page.getByRole("heading", { name: "Overlays and inputs" }).click();
    await expect(popover).toHaveCount(0);
  });
});

test.describe("select and combobox", () => {
  test("the select changes value from the keyboard", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const select = page.getByRole("combobox", { name: "Status", exact: true });
    await select.focus();
    await page.keyboard.press("ArrowDown");
    const listbox = page.getByRole("listbox");
    await settled(listbox);
    await listbox.getByRole("option", { name: /Silenced/ }).click();
    await expect(select).toContainText("Silenced");
    await expect(select).toBeFocused();
  });

  test("the select opens on click and picks", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const select = page.getByRole("combobox", { name: "Status", exact: true });
    await select.click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /Pending/ })
      .click();
    await expect(select).toContainText("Pending");
  });

  test("the combobox filters as you type and picks with Enter", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const owner = page.getByRole("combobox", { name: "Owner" }).first();
    await owner.click();
    const search = page.getByRole("dialog").getByRole("combobox", {
      name: "Owner",
    });
    await expect(search).toBeFocused();
    await search.fill("riv");
    const listbox = page.getByRole("listbox");
    await expect(
      listbox.getByRole("option", { name: /Sam Rivera/ }),
    ).toBeVisible();
    await expect(listbox.getByRole("option", { name: /Claude/ })).toHaveCount(
      0,
    );
    await page.keyboard.press("Enter");
    await expect(listbox).toHaveCount(0);
    await expect(owner).toContainText("Sam Rivera");
  });

  test("the multiple combobox adds chips, creates a label and removes one", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const input = page.getByRole("combobox", { name: "Labels" });
    await input.click();
    await input.fill("stor");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Remove storage" }),
    ).toBeAttached();
    await input.fill("disk-io");
    await expect(
      page.getByRole("option", { name: "Create “disk-io”" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Remove disk-io" }),
    ).toBeAttached();
    // The list stays open for more picks; Escape closes it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove prod" }).click();
    await expect(page.getByRole("button", { name: "Remove prod" })).toHaveCount(
      0,
    );
  });

  test("the async combobox says Searching… then lists results", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("combobox", { name: "Service" }).first().click();
    const search = page.getByRole("dialog").getByRole("combobox", {
      name: "Service",
    });
    await search.fill("tem");
    await expect(page.getByText("Searching…")).toBeVisible();
    const listbox = page.getByRole("listbox");
    await expect(
      listbox.getByRole("option", { name: "temporal-worker" }),
    ).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: "tempo", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Searching…")).toHaveCount(0);
  });
});

test.describe("toasts", () => {
  test("Undo reverses the change and F6 reaches the toasts", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const region = page.getByRole("region", { name: "Notifications" });
    const toast = region
      .getByRole("group")
      .filter({ hasText: "Acknowledged 4 alerts" });
    await settled(toast);
    await page.keyboard.press("F6");
    await expect(region).toBeFocused();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(toast).toHaveCount(0);
    await expect(region.getByText("Acknowledgement undone")).toBeVisible();
  });

  test("the newest undo also runs from ⌘Z", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByText("Acknowledged 4 alerts")).toBeVisible();
    await page.locator("body").press("ControlOrMeta+z");
    await expect(page.getByText("Acknowledgement undone")).toBeVisible();
  });
});

test.describe("sheets and shortcuts", () => {
  test("the side sheet traps focus, closes on Escape and returns focus", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Side panel" });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "go/ha" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveCSS("transform", "none");
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("? opens the shortcut sheet from the registry", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.locator("body").press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await settled(sheet);
    await expect(sheet.getByText("Go to the detail page")).toBeVisible();
    await expect(sheet.locator("kbd")).not.toHaveCount(0);
    // Shortcuts are off while a dialog is open.
    await page.keyboard.press("n");
    await expect(page.getByText("Pressed N")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await page.locator("body").press("n");
    await expect(page.getByText("Pressed N")).toBeVisible();
  });

  test("a two-key sequence navigates", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.locator("body").press("g");
    await page.locator("body").press("d");
    await expect(page).toHaveURL(/\/kit\/detail$/);
  });
});

test.describe("command palette steps", () => {
  test("a command steps into a list; Backspace and Escape go back", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Step palette" }).click();
    const palette = page.getByRole("dialog", { name: "Gallery commands" });
    await settled(palette);
    const input = palette.getByRole("combobox");
    await input.fill("status");
    await page.keyboard.press("Enter");
    await expect(
      palette.getByText("Set status", { exact: true }),
    ).toBeVisible();
    await expect(input).toHaveAttribute(
      "aria-label",
      "Gallery commands: Set status",
    );
    await expect(palette.getByRole("option", { name: /Firing/ })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(input).toHaveAttribute("aria-label", "Gallery commands");
    await input.fill("status");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(palette).toBeVisible();
    await expect(input).toHaveAttribute("aria-label", "Gallery commands");
    await input.fill("status");
    await page.keyboard.press("Enter");
    await palette.getByRole("option", { name: /Resolved/ }).click();
    await expect(palette).toHaveCount(0);
    await expect(page.getByText("Status set to resolved")).toBeVisible();
  });

  test("server results load after the static commands", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await page.getByRole("button", { name: "Step palette" }).click();
    const palette = page.getByRole("dialog", { name: "Gallery commands" });
    await palette.getByRole("combobox").fill("disk");
    await expect(palette.getByText("Searching…")).toBeVisible();
    await expect(
      palette.getByRole("option", { name: /DiskPressure/ }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/kit\/detail$/);
  });
});

/** Opens each overlay in turn and runs `check` with it on screen. */
async function eachOverlay(
  page: Page,
  check: (name: string) => Promise<void>,
): Promise<void> {
  await page.getByRole("button", { name: "Actions" }).click();
  await settled(actionsMenu(page));
  await check("menu");
  await page.keyboard.press("Escape");
  await expect(actionsMenu(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Display" }).click();
  const popover = page.getByRole("dialog", { name: "Display" });
  await settled(popover);
  await check("popover");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  await page.getByRole("combobox", { name: "Owner" }).first().click();
  const listbox = page.getByRole("listbox");
  await settled(listbox);
  await check("combobox listbox");
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);

  await page.getByRole("button", { name: "Side panel" }).click();
  const sheet = page.getByRole("dialog", { name: "go/ha" });
  await expect(sheet).toHaveCSS("transform", "none");
  await check("sheet");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await settled(
    page.getByRole("group").filter({ hasText: "Acknowledged 4 alerts" }),
  );
  await check("toast");
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every open overlay has zero axe violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    await openGallery(page);
    await eachOverlay(page, async (name) => {
      expect(await violations(legacyAxe(page)), name).toEqual([]);
    });
  });
}

for (const viewport of [PHONE, DESKTOP]) {
  test(`no overlay overflows sideways at ${String(viewport.width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openGallery(page);
    await eachOverlay(page, async (name) => {
      const overflow = await horizontalOverflow(page);
      expect(overflow.document, name).toBeLessThanOrEqual(0);
    });
  });
}

test("the bottom sheet rises from the bottom on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openGallery(page);
  await page.getByRole("button", { name: "More (phone)" }).click();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toHaveCSS("transform", "none");
  const box = await sheet.boundingBox();
  expect(box?.width).toBe(PHONE.width);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(PHONE.height, 0);
  expect(await violations(legacyAxe(page))).toEqual([]);
});
