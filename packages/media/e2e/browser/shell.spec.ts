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

/**
 * Runs `act` with the page's clock held still. The search field waits for a
 * pause in the typing before it searches; with the clock held, what `act`
 * does "before the field has searched" is before it on any machine, however
 * slow, and `page.clock.runFor` inside `act` is what lets a pause run out.
 * The clock runs again afterwards whether or not `act` succeeded.
 */
async function withClockHeld<Result>(
  page: Page,
  act: () => Promise<Result>,
): Promise<Result> {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  try {
    return await act();
  } finally {
    await page.clock.resume();
  }
}

/**
 * Types over the search on screen, then leaves by `leave` before the field
 * has sent it, and expects the leaving to stand once the field's pause has
 * run out: the browse rows, an empty field, and nothing searched for.
 */
async function leaveBeforeTypedSearchIsSent(
  page: Page,
  leave: () => Promise<void>,
) {
  const search = page.getByRole("searchbox", {
    name: "Search films and series",
  });
  await withClockHeld(page, async () => {
    await search.fill("dune part");
    await leave();
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(search).toHaveValue("");
    // The pause runs out.
    await page.clock.runFor(1000);
  });
  expect(address(page)).toBe("/discover");
  await expect(search).toHaveValue("");
  await expect(
    page.getByRole("heading", { level: 2, name: "Trending this week" }),
  ).toBeVisible();
  expect(address(page)).toBe("/discover");
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

  test("a member who opens a Manage address is sent Home", async ({ page }) => {
    await openAs(page, "member", "/library");
    await page.goto("/manage/quality");
    await expect.poll(() => address(page)).toBe("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");
  });

  test("the first item of the navigation opens Home", async ({ page }) => {
    await openAs(page, "member", "/library");
    const main = page.getByRole("navigation", { name: "Main" });
    await main.getByRole("link", { name: "Home" }).click();
    await expect.poll(() => address(page)).toBe("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeFocused();
    // Home is marked at its own address and at no address beneath it.
    await expect(main.locator("[aria-current]")).toHaveText("Home");
    await main.getByRole("link", { name: "Library" }).click();
    await expect(main.locator("[aria-current]")).toHaveText("Library");
  });
});

test.describe("top bar", () => {
  test("search opens Discover with a linkable query", async ({ page }) => {
    await openAs(page, "member", "/library");
    const search = page.getByRole("searchbox", {
      name: "Search films and series",
    });
    // Away from Discover nothing happens until the search is sent.
    await search.fill("the");
    await expect(page).toHaveURL(/\/library$/u);
    await search.press("Enter");
    await expect(page).toHaveURL(/\/discover\?q=the$/u);
    await expect(
      page.getByRole("heading", { name: "Results for “the”" }),
    ).toBeVisible();
    // The field is the only one on the page, and it keeps the search.
    await expect(page.getByRole("searchbox")).toHaveCount(1);
    await expect(search).toHaveValue("the");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Results for “the”" }),
    ).toBeVisible();
    await expect(search).toHaveValue("the");

    // Sent again from Discover, a search replaces the one before it.
    await search.fill("no-such-title");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/discover\?q=no-such-title$/u);
    await expect(search).toHaveValue("no-such-title");
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/u);
    await expect(search).toHaveValue("");
  });

  test("a search typed on one page does not follow the reader to another", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    const search = page.getByRole("searchbox", {
      name: "Search films and series",
    });
    // Typed, then left before the pause that would have searched.
    await search.pressSequentially("dune", { delay: 0 });
    await page.getByRole("link", { name: "Notifications" }).click();
    await expect(page).toHaveURL(/\/notifications$/u);
    await expect(search).toHaveValue("");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/notifications$/u);
  });

  test("clearing the search drops a refinement that was still waiting to be sent", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover?q=dune");
    await expect(
      page.getByRole("searchbox", { name: "Search films and series" }),
    ).toHaveValue("dune");
    // The clear stands, although it leaves the reader on the same page.
    await leaveBeforeTypedSearchIsSent(page, async () => {
      await page.getByRole("link", { name: "Clear search" }).click();
    });
  });

  test("going Back drops a refinement that was still waiting to be sent", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    // The first search adds a history entry over the browse rows.
    await page
      .getByRole("searchbox", { name: "Search films and series" })
      .fill("dune");
    await expect.poll(() => address(page)).toBe("/discover?q=dune");
    // Back stands, although it leaves the reader on the same page.
    await leaveBeforeTypedSearchIsSent(page, async () => {
      await page.goBack();
    });
  });

  test("opening an input method drops the search typed before it, and the finished text is searched for", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    const search = page.getByRole("searchbox", {
      name: "Search films and series",
    });
    // The browser's own input-method composition, as a keyboard for
    // Japanese, Chinese or Korean drives it.
    const keyboard = await page.context().newCDPSession(page);
    const whileComposing = await withClockHeld(page, async () => {
      // Typed, and then a composition begun before the field's pause ran out.
      await search.fill("du");
      await keyboard.send("Input.imeSetComposition", {
        text: "ね",
        selectionStart: 1,
        selectionEnd: 1,
      });
      await expect(search).toHaveValue("duね");
      await page.clock.runFor(1000);
      const shown = address(page);
      // The composition is confirmed; the pause after it runs out too.
      await keyboard.send("Input.insertText", { text: "ね" });
      await page.clock.runFor(1000);
      return shown;
    });
    // Nothing was searched for while the text was unfinished.
    expect(whileComposing).toBe("/discover");
    await expect
      .poll(() => address(page))
      .toBe(`/discover?q=${encodeURIComponent("duね")}`);
    await expect(search).toHaveValue("duね");
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
    // Recovery is where a member answers; the owner works from Manage.
    ["/recovery?from=email#top", "/manage/recovery?from=email#top"],
    ["/manage", "/manage/household"],
    ["/no-such-page", "/"],
  ] as const;

  for (const [from, to] of OWNER_MOVES) {
    test(`the owner's ${from} opens ${to}`, async ({ page }) => {
      await openAs(page, "owner", from);
      await expect.poll(() => address(page)).toBe(to);
    });
  }

  // A redirect alone is not a navigation the person made: arriving by an
  // address that moved must not put a focus ring on the heading.
  test("a redirected arrival leaves focus where the browser put it", async ({
    page,
  }) => {
    await openAs(page, "member", "/removals");
    await expect.poll(() => address(page)).toBe("/library/leaving");
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
    test(`a member's ${from} opens Home`, async ({ page }) => {
      await openAs(page, "member", from);
      await expect.poll(() => address(page)).toBe("/");
    });
  }

  // Addresses the server still writes into messages, which did not move,
  // and the front door, which is Home and no longer sends anyone on.
  const KEPT = ["/", "/library", "/recovery", "/notifications"] as const;

  for (const kept of KEPT) {
    test(`${kept} is still its own page`, async ({ page }) => {
      await openAs(page, "member", kept);
      await page.waitForLoadState("networkidle");
      expect(address(page)).toBe(kept);
    });
  }
});
