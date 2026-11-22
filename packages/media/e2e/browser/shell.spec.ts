import { expect, type Page } from "@playwright/test";
import {
  canvasColor,
  computedForm,
  openAs,
  test,
  violationDetails,
} from "./support.ts";

/*
 * The parts of the shell every screen has. What only a wide screen or only a
 * phone has is in `shell.desktop.spec.ts` and `shell.phone.spec.ts`, which
 * `playwright.config.ts` gives to the one project each belongs to.
 */

/** The address as the browser shows it, without the origin. */
function address(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}${url.hash}`;
}

async function themeColor(page: Page, scheme: "light" | "dark") {
  const content = await page
    .locator(
      `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
    )
    .getAttribute("content");
  if (content === null) throw new Error(`No ${scheme} theme color`);
  return content;
}

test.describe("navigation", () => {
  test("focus waits for the heading of a page that loads its title", async ({
    page,
  }) => {
    await openAs(page, "member", "/library");
    await page
      .getByRole("list", { name: "Library titles" })
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/media\//u);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("a member who opens a Manage address is sent to Discover", async ({
    page,
  }) => {
    await openAs(page, "member", "/library");
    await page.goto("/manage/quality");
    await expect(page).toHaveURL(/\/discover$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "What’s your next watch?",
    );
  });
});

test.describe("top bar", () => {
  test("search opens Discover with a linkable query", async ({ page }) => {
    await openAs(page, "member", "/library");
    const search = page.getByRole("searchbox", {
      name: "Search films and series",
    });
    await search.fill("the");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/discover\?q=the$/u);
    await expect(
      page.getByRole("heading", { name: "Results for “the”" }),
    ).toBeVisible();
    // The page's own form shows the same search, and it survives a reload.
    const own = page.getByRole("searchbox", {
      name: "Search movies and series",
    });
    await expect(own).toHaveValue("the");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Results for “the”" }),
    ).toBeVisible();
    await expect(search).toHaveValue("the");

    // Searching from the page's own form updates the address too.
    await own.fill("no-such-title");
    await own.press("Enter");
    await expect(page).toHaveURL(/\/discover\?q=no-such-title$/u);
    await expect(search).toHaveValue("no-such-title");
  });

  test("the bell opens notifications", async ({ page }) => {
    await openAs(page, "member", "/library");
    const bell = page.getByRole("link", { name: "Notifications" });
    await bell.click();
    await expect(page).toHaveURL(/\/notifications$/u);
    await expect(bell).toHaveAttribute("aria-current", "page");
  });

  test("the account panel opens, closes, and returns focus", async ({
    page,
  }) => {
    await openAs(page, "member", "/library");
    const account = page.getByRole("button", { name: "Account" });
    const theme = page.getByRole("group", { name: "Theme" });
    await expect(theme).toBeHidden();

    await account.click();
    await expect(account).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Library member")).toBeVisible();
    await expect(theme.getByRole("radio")).toHaveCount(3);

    // Tab walks the panel in reading order.
    await account.focus();
    await page.keyboard.press("Tab");
    await expect(theme.getByRole("radio", { name: "System" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Notification settings" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Recovery reviews" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(theme).toBeHidden();
    await expect(account).toBeFocused();
    await expect(account).toHaveAttribute("aria-expanded", "false");

    // A press anywhere else closes it.
    await account.click();
    await expect(theme).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search films and series" })
      .click();
    await expect(theme).toBeHidden();

    // Members answer recovery reviews, so the link is theirs too.
    await account.click();
    await page.getByRole("link", { name: "Recovery reviews" }).click();
    await expect(page).toHaveURL(/\/recovery$/u);
    await expect(theme).toBeHidden();
  });
});

for (const scheme of ["light", "dark"] as const) {
  const other = scheme === "light" ? "dark" : "light";
  const otherLabel = other === "dark" ? "Dark" : "Light";

  test.describe(`theme on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    // The route suite checks every page with the shell closed.
    test("the open account panel is accessible", async ({ page }) => {
      await openAs(page, "owner", "/manage/quality");
      await page.getByRole("button", { name: "Account" }).click();
      await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
      expect(await violationDetails(page)).toEqual([]);
    });

    test(`pinning ${other} holds across a reload, and System gives it back`, async ({
      page,
    }) => {
      await openAs(page, "member", "/library");
      const canvas = {
        light: computedForm(await themeColor(page, "light")),
        dark: computedForm(await themeColor(page, "dark")),
      };
      expect(await canvasColor(page)).toBe(canvas[scheme]);

      const account = page.getByRole("button", { name: "Account" });
      await account.click();
      const theme = page.getByRole("group", { name: "Theme" });
      await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
      await expect(theme).toHaveAccessibleDescription(
        `Matches this device, which is ${scheme} right now.`,
      );

      await theme.getByText(otherLabel).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      expect(await canvasColor(page)).toBe(canvas[other]);
      // The browser chrome is told the pinned canvas for either scheme.
      expect(computedForm(await themeColor(page, "light"))).toBe(canvas[other]);
      expect(computedForm(await themeColor(page, "dark"))).toBe(canvas[other]);

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      expect(await canvasColor(page)).toBe(canvas[other]);

      // System gives the choice back to the device.
      await account.click();
      await expect(
        theme.getByRole("radio", { name: otherLabel }),
      ).toBeChecked();
      await theme.getByText("System").click();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      expect(await canvasColor(page)).toBe(canvas[scheme]);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await canvasColor(page)).toBe(canvas[scheme]);
    });
  });
}

test.describe("addresses that moved", () => {
  // Query string and fragment travel with every redirect.
  const OWNER_MOVES = [
    ["/", "/discover"],
    ["/?q=the#results", "/discover?q=the#results"],
    ["/admin?from=email#access", "/manage/household?from=email#access"],
    ["/admin/migration?from=email#top", "/manage/migration?from=email#top"],
    [
      "/admin/subtitle-replacements?from=email#top",
      "/manage/subtitles/replacements?from=email#top",
    ],
    [
      "/admin/subtitle-replacements/abc?from=email#top",
      "/manage/subtitles/replacements/abc?from=email#top",
    ],
    [
      "/recovery/native?from=email#top",
      "/manage/recovery/native?from=email#top",
    ],
    [
      "/recovery/native/archives?from=email#top",
      "/manage/recovery/native/archives?from=email#top",
    ],
    ["/activity?from=email#top", "/manage/activity?from=email#top"],
    ["/manage", "/manage/household"],
    ["/no-such-page", "/discover"],
  ] as const;

  for (const [from, to] of OWNER_MOVES) {
    test(`the owner's ${from} opens ${to}`, async ({ page }) => {
      await openAs(page, "owner", from);
      await expect.poll(() => address(page)).toBe(to);
    });
  }

  // A redirect alone is not a navigation the person made: arriving at the
  // front door must not put a focus ring on the heading.
  test("a redirected arrival leaves focus where the browser put it", async ({
    page,
  }) => {
    await openAs(page, "member", "/");
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
    await expect(page.locator("#main")).not.toBeFocused();
  });

  // Manage is the owner's: a member is sent home, not to a page that refuses.
  for (const from of [
    "/admin",
    "/admin/migration",
    "/admin/subtitle-replacements/abc",
    "/recovery/native",
    "/activity",
    "/manage/household",
  ]) {
    test(`a member's ${from} opens Discover`, async ({ page }) => {
      await openAs(page, "member", from);
      await expect.poll(() => address(page)).toBe("/discover");
    });
  }

  // Addresses the server still writes into messages, which did not move.
  const KEPT = ["/library", "/recovery", "/notifications"] as const;

  for (const kept of KEPT) {
    test(`${kept} is still its own page`, async ({ page }) => {
      await openAs(page, "member", kept);
      await page.waitForLoadState("networkidle");
      expect(address(page)).toBe(kept);
    });
  }
});
