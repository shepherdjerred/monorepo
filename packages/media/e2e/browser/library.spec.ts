import { expect, type Page } from "@playwright/test";
import { UNREACHABLE_POSTER_TITLE } from "#testing/fixture-api/fixtures/artwork-image.ts";
import { openAs, test, violationDetails } from "./support.ts";

/*
 * The Library's All segment: the poster grid, its filters, and the compact
 * list. Runs at both viewports.
 */

const grid = (page: Page) => page.getByRole("list", { name: "Library titles" });

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading" }),
  ).toHaveCount(0);
}

/** How many columns the grid has laid its cards out in. */
async function columns(page: Page): Promise<number> {
  return grid(page).evaluate(
    (list) =>
      globalThis.getComputedStyle(list).gridTemplateColumns.split(" ").length,
  );
}

test("the grid shows posters in columns that follow its own width", async ({
  page,
}) => {
  await openAs(page, "member", "/library");
  await settle(page);
  const cards = grid(page).getByRole("listitem");
  await expect(cards).toHaveCount(48);

  // A poster from the artwork route, drawn in its reserved 2:3 frame.
  const alien = cards.filter({ hasText: "Alien" }).first();
  const poster = alien.locator("img");
  await expect(poster).toHaveAttribute("loading", "lazy");
  await expect(poster).toHaveAttribute("srcset", /\/api\/v1\/artwork\/w185\//u);
  expect(
    await poster.evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  const box = await poster.boundingBox();
  if (box === null) throw new Error("The poster has no box");
  expect(box.height / box.width).toBeCloseTo(1.5, 1);
  // The phrase is a pill in the art's top corner where a card has room for
  // it, and a band along the foot where three cards share a phone's width.
  const phrase = await alien.getByText("Ready to watch").boundingBox();
  if (phrase === null) throw new Error("The state phrase has no box");
  const fromTop = (phrase.y - box.y) / box.height;
  if ((page.viewportSize()?.width ?? 0) > 760) {
    expect(fromTop).toBeLessThan(0.2);
    expect(phrase.width).toBeLessThan(box.width);
  } else {
    expect(fromTop).toBeGreaterThan(0.8);
    expect(phrase.width).toBeCloseTo(box.width, 0);
  }

  // A title with no stored artwork shows its name in the same frame.
  const arrival = cards.filter({ hasText: "Arrival" }).first();
  await expect(arrival.locator("img")).toHaveCount(0);
  await expect(arrival.getByText("Ready to watch")).toHaveCount(0);
  await expect(arrival.getByText("On the way")).toBeVisible();

  // One plain phrase per card, none of them system vocabulary.
  await expect(cards.filter({ hasText: "Severance" })).toContainText(
    "9 of 19 episodes",
  );
  await expect(grid(page)).not.toContainText(/policy|unclassified|_/iu);

  const width = page.viewportSize()?.width ?? 0;
  expect(await columns(page)).toBe(width > 760 ? 7 : 3);
  expect(
    await page
      .locator("html")
      .evaluate((root) => root.scrollWidth - root.clientWidth),
  ).toBe(0);
});

test("a poster that cannot be fetched gives way to the title's name", async ({
  page,
}) => {
  await openAs(
    page,
    "member",
    `/library?q=${encodeURIComponent(UNREACHABLE_POSTER_TITLE)}`,
  );
  await settle(page);
  const card = grid(page).getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card.locator("img")).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "Your Name. Ready to watch Film, 2016" }),
  ).toBeVisible();
});

test("search, filters, sort and layout live in the address and survive a reload", async ({
  page,
}) => {
  await openAs(page, "owner", "/library");
  await settle(page);
  await page.getByLabel("Films or series").selectOption("series");
  await page.getByLabel("How long it is kept").selectOption("keep");
  await page.getByLabel("Sort by").selectOption("added");
  await page.getByLabel("Search the library by title").fill("the");
  await expect(page).toHaveURL(
    /\/library\?q=the&kind=series&keeping=keep&sort=added$/u,
  );
  await settle(page);
  // The earlier answer stays on screen, dimmed, until the new one arrives.
  const titles = () => grid(page).getByRole("heading").allTextContents();
  await expect
    .poll(async () => {
      const current = await titles();
      return current.every((title) => title.toLowerCase().includes("the"));
    })
    .toBe(true);
  await expect(grid(page)).toHaveAttribute("aria-busy", "false");
  const shown = await titles();
  expect(shown.length).toBeGreaterThan(0);

  await page.reload();
  await settle(page);
  await expect(page.getByLabel("Search the library by title")).toHaveValue(
    "the",
  );
  await expect(page.getByLabel("Films or series")).toHaveValue("series");
  expect(await grid(page).getByRole("heading").allTextContents()).toEqual(
    shown,
  );

  // Nothing matches: the empty state says so and offers the way out.
  await page.getByLabel("Search the library by title").fill("zzzz");
  await expect(
    page.getByRole("heading", { name: "No titles match" }),
  ).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(/\/library\?sort=added$/u);
  await expect(page.getByLabel("Search the library by title")).toHaveValue("");
});

test("more titles load on request, after the ones already shown", async ({
  page,
}) => {
  await openAs(page, "member", "/library");
  await settle(page);
  await page.getByRole("button", { name: "Show more titles" }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(60);
  await expect(
    page.getByRole("button", { name: "Show more titles" }),
  ).toHaveCount(0);
});

test("the compact list is where the owner changes how long a title is kept", async ({
  page,
}) => {
  await openAs(page, "owner", "/library");
  await settle(page);
  const layout = page.getByRole("navigation", { name: "Layout" });
  await layout.getByRole("link", { name: "Compact list" }).click();
  await expect(page).toHaveURL(/\/library\?view=list$/u);
  await expect(
    layout.getByRole("link", { name: "Compact list" }),
  ).toHaveAttribute("aria-current", "true");

  const rows = grid(page).getByRole("listitem");
  await expect(rows).toHaveCount(48);
  const kept = rows.filter({
    has: page.getByRole("link", { name: "Dune", exact: true }),
  });
  await expect(kept).toContainText("Kept for good");
  await expect(
    kept.getByRole("button", { name: "Keep just for now: Dune" }),
  ).toBeVisible();
  const temporary = rows.filter({
    has: page.getByRole("link", { name: "Alien", exact: true }),
  });
  await expect(temporary).toContainText("Just for now");
  await expect(
    temporary.getByRole("button", { name: "Keep for good: Alien" }),
  ).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);

  // The fixture API is read-only, so the command is answered here: it must
  // name the versions the row was read at.
  let sent: unknown = null;
  await page
    .context()
    .addCookies([
      { name: "media-csrf", value: "browser-test", url: page.url() },
    ]);
  await page.route(/\/keeping-policy$/u, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 409,
      json: {
        error: { code: "conflict", message: "This title changed. Reload it." },
      },
    });
  });
  await temporary.getByRole("button", { name: /Keep for good/u }).click();
  await expect(temporary.getByRole("alert")).toHaveText(
    "This title changed. Reload it.",
  );
  expect(sent).toMatchObject({
    schemaVersion: 1,
    edition: "default",
    keepingPolicy: "keep",
  });
});

test("a member sees how long titles are kept but cannot change it", async ({
  page,
}) => {
  await openAs(page, "member", "/library?view=list");
  await settle(page);
  await expect(grid(page).getByRole("listitem").first()).toContainText(
    "Just for now",
  );
  await expect(grid(page).getByRole("button")).toHaveCount(0);
});

test("a library that cannot be read says why and offers another try", async ({
  page,
}) => {
  let refuse = true;
  await page.route(/\/api\/v1\/library\?/u, async (route) => {
    if (!refuse) return route.fallback();
    await route.fulfill({
      status: 403,
      json: {
        error: {
          code: "plex_library_access_required",
          message:
            "This account no longer has the configured Plex library access",
        },
      },
    });
  });
  await openAs(page, "member", "/library");
  const failure = page.getByRole("alert");
  await expect(
    failure.getByRole("heading", {
      name: "Media could not confirm your Plex access",
    }),
  ).toBeVisible();
  expect(await violationDetails(page)).toEqual([]);
  refuse = false;
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(48);
});
