import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  DESKTOP,
  expectPagesFitViewport,
  gotoLoadedPage,
  PHONE,
  violations,
} from "./helpers.ts";

/** The console-ui gallery: every shared piece, on a list and a detail page. */
const KIT_PATHS = ["/kit", "/kit/detail"] as const;

test("the gallery opens from the command palette, not the sidebar", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/");
  const sidebar = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(sidebar.getByRole("link", { name: /kit/i })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await palette.getByRole("combobox").fill("gallery");
  await palette
    .getByRole("option", { name: "Open the console kit gallery" })
    .click();
  await expect(page).toHaveURL(/\/kit$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Console kit" }),
  ).toBeVisible();
});

for (const viewport of [PHONE, DESKTOP]) {
  test(`the gallery fits ${String(viewport.width)}px without horizontal overflow`, async ({
    page,
  }) => {
    await expectPagesFitViewport(page, viewport, KIT_PATHS);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the gallery and its dialog have zero axe violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [DESKTOP, PHONE]) {
      await page.setViewportSize(viewport);
      for (const path of KIT_PATHS) {
        await gotoLoadedPage(page, path);
        // Legacy mode: the sandboxed email preview frame cannot run axe's
        // cross-frame scripts, so axe checks the frame as one element.
        expect(
          await violations(new AxeBuilder({ page }).setLegacyMode(true)),
          path,
        ).toEqual([]);
      }
    }
    await page.setViewportSize(DESKTOP);
    await gotoLoadedPage(page, "/kit");
    await page.getByRole("button", { name: "Delete link…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete go/ha?" });
    await expect(dialog).toBeVisible();
    // Axe reads colours mid-fade as low contrast; wait for the open transition.
    await expect(dialog).toHaveCSS("opacity", "1");
    expect(await violations(page), "dialog").toEqual([]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete link…" }),
    ).toBeFocused();
  });
}

test("a stacked table reads as label and value lines on a phone", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await gotoLoadedPage(page, "/kit");
  const status = page
    .getByRole("table")
    .first()
    .locator('td[data-label="Status"]')
    .first();
  const label = await status.evaluate(
    (cell) => getComputedStyle(cell, "::before").content,
  );
  expect(label).toBe('"Status"');
  await expect(page.locator("thead").first()).toHaveCSS("position", "absolute");
});

test("the detail and forms section shows validation errors and a summary", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/kit");
  const summary = page
    .getByRole("alert")
    .filter({ hasText: "problems to fix" });
  await expect(summary).toBeVisible();
  await summary.getByRole("link", { name: "Target URL" }).click();
  await expect(page.getByLabel("Target URL")).toBeFocused();
  await page.getByLabel("Target URL").fill("https://ha.example.com");
  await page.getByLabel("Short link").fill("ha");
  await expect(summary).toHaveCount(0);
});

test("copy announces and the search shortcut focuses the filter", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/kit");
  await page.getByRole("button", { name: "Copy fingerprint" }).click();
  await expect(page.getByText("Copied", { exact: true })).toBeAttached();
  expect(
    await page.evaluate(() => globalThis.navigator.clipboard.readText()),
  ).toBe("9f2c41ab77d0");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Filter alerts")).toBeFocused();
  await page.keyboard.type("a/b");
  await expect(page.getByLabel("Filter alerts")).toHaveValue("a/b");
});

test("the email preview is sandboxed and toggles dark and plain text", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await gotoLoadedPage(page, "/kit");
  const frame = page.locator("iframe.ui-email-frame");
  await expect(frame).toHaveAttribute("sandbox", "");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(frame).toHaveAttribute("data-scheme", "dark");
  await page.getByRole("radio", { name: "Plain text" }).click();
  await expect(page.locator("pre.ui-email-text")).toContainText(
    "Weekly digest",
  );
});
