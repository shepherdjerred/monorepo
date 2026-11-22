import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { UNAVAILABLE_FEED } from "#testing/fixture-api/fixtures/catalog.ts";
import { FEED_COPY } from "#client/presentation/catalog.ts";
import {
  address,
  inScenario,
  openAs,
  horizontalOverflow,
  settle,
  test,
  violationDetails,
} from "./support.ts";

/*
 * Discover: the browse rows, search, one whole feed, and the two states the
 * catalog can put the page in (a feed that is down, and library access that
 * could not be confirmed). Runs at both viewports; what only a mouse or only
 * a finger gets is in `discover.desktop.spec.ts` and `discover.phone.spec.ts`.
 */

const ROWS = [
  "Trending this week",
  "Popular films",
  "Popular series",
  "Airing this week",
  "Upcoming films",
] as const;
const DOWN = FEED_COPY[UNAVAILABLE_FEED].title;

const rail = (page: Page, name: string) =>
  page.getByRole("list", { name, exact: true });
const search = (page: Page) =>
  page.getByRole("searchbox", { name: "Search films and series" });
const results = (page: Page) =>
  page.getByRole("list", { name: "Search results" });

async function scrolledBy(list: Locator): Promise<number> {
  return list.evaluate((element) => Math.round(element.scrollLeft));
}

test.describe("browse rows", () => {
  test("every feed is a row of poster cards that says what the household has", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    await settle(page);
    await expect(page).toHaveTitle("Discover · Media");
    await expect(
      page.locator("#main").getByRole("heading", { level: 2 }),
    ).toHaveText([...ROWS]);
    for (const row of ROWS) {
      await expect(rail(page, row).getByRole("listitem")).toHaveCount(20);
    }

    const trending = rail(page, ROWS[0]);
    // A series a Plex library outside Media holds: there, with no count.
    await expect(
      trending.getByRole("link", {
        name: "The Wire In the library Series, 2002 Others follow this",
      }),
    ).toHaveAttribute("href", /^\/media\//u);
    // A title the household does not have offers a request, on its own page.
    const offered = trending.getByRole("link", { name: /Request/u }).first();
    await expect(offered).toHaveAttribute(
      "href",
      /^\/catalog\/(movie|series)\/\d+$/u,
    );
    // A film that is not out yet gives its day, not its year.
    await expect(
      rail(page, "Upcoming films")
        .getByRole("listitem")
        .first()
        .getByText(/^Film, [A-Z][a-z]{2} \d{1,2}$/u),
    ).toBeVisible();

    // Posters come from the artwork route, lazily, in a reserved 2:3 frame;
    // none of them asks to jump the queue.
    const poster = trending.locator("img").first();
    await expect(poster).toHaveAttribute("loading", "lazy");
    await expect(poster).toHaveAttribute(
      "srcset",
      /\/api\/v1\/artwork\/w185\//u,
    );
    await expect(page.locator("img[fetchpriority]")).toHaveCount(0);
    const box = await poster.boundingBox();
    if (box === null) throw new Error("The poster has no box");
    expect(box.height / box.width).toBeCloseTo(1.5, 1);

    // No member sees a contract value.
    await expect(page.locator("#main")).not.toContainText(
      /popular_|on_the_air|_movies|unavailable|stale/iu,
    );
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("a row scrolls sideways on its own, snapped to its cards, and never traps the page", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    await settle(page);
    const list = rail(page, "Popular films");
    const shape = await list.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        scrolls: element.scrollWidth > element.clientWidth,
        overflowX: style.overflowX,
        snap: style.scrollSnapType,
        cardSnap: globalThis.getComputedStyle(
          element.firstElementChild ?? element,
        ).scrollSnapAlign,
      };
    });
    expect(shape).toEqual({
      scrolls: true,
      overflowX: "auto",
      snap: "x mandatory",
      cardSnap: "start",
    });

    // Tab walks the cards, and the row follows the focus.
    const cards = list.getByRole("link");
    await cards.first().focus();
    for (let presses = 0; presses < 9; presses += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(cards.nth(9)).toBeFocused();
    await expect.poll(async () => scrolledBy(list)).toBeGreaterThan(0);
    await expect(cards.nth(9)).toBeInViewport();
    expect(await horizontalOverflow(page)).toBe(0);

    // A wheel turned over a row scrolls the page, as it does anywhere else.
    await list.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => globalThis.scrollY);
    await list.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(async () => page.evaluate(() => globalThis.scrollY))
      .toBeGreaterThan(before);
  });

  test("a row takes the same room while it loads as when it has loaded", async ({
    page,
  }) => {
    // Every feed's read is held until the loading shapes are measured.
    const feedReads = /\/api\/v1\/catalog\/discover/u;
    const held: Route[] = [];
    await page.route(feedReads, (route) => {
      held.push(route);
    });
    await openAs(page, "member", "/discover");
    const rows = page.locator("#main section");
    await expect(page.getByRole("status")).toHaveText(
      ROWS.map((row) => `Loading ${row}`),
    );
    const loading = await rows.evaluateAll((sections) =>
      sections.map((section) => section.getBoundingClientRect().height),
    );
    expect(loading).toHaveLength(ROWS.length);
    await page.unroute(feedReads);
    await Promise.all(held.map(async (route) => route.fallback()));
    await settle(page);
    await expect(rail(page, ROWS[0]).getByRole("listitem")).toHaveCount(20);
    const loaded = await rows.evaluateAll((sections) =>
      sections.map((section) => section.getBoundingClientRect().height),
    );
    expect(loaded).toEqual(loading);
  });
});

test.describe("search", () => {
  test("a search in the address shows its results as cards, a page at a time", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover?q=the");
    await settle(page);
    await expect(
      page.getByRole("heading", { level: 2, name: "Results for “the”" }),
    ).toBeVisible();
    await expect(search(page)).toHaveValue("the");
    const cards = results(page).getByRole("listitem");
    await expect(cards).toHaveCount(20);
    await expect(page.getByRole("status")).toHaveText(
      "20 titles shown, more to load",
    );
    // What the household has, and what it could ask for, in one list.
    await expect(
      results(page).getByRole("link", {
        name: "The Godfather Ready to watch Film, 1972 Others follow this",
      }),
    ).toHaveAttribute("href", /^\/media\//u);
    await expect(
      results(page).getByRole("link", {
        name: "The Dark Knight Request Film, 2008",
      }),
    ).toHaveAttribute("href", "/catalog/movie/155");

    await page.getByRole("button", { name: "Show more titles" }).click();
    await expect(cards).toHaveCount(26);
    await expect(
      page.getByRole("button", { name: "Show more titles" }),
    ).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveText("26 titles shown");
    expect(await horizontalOverflow(page)).toBe(0);

    await page.getByRole("link", { name: "Clear search" }).click();
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(search(page)).toHaveValue("");
    await expect(rail(page, ROWS[0])).toBeVisible();
  });

  test("on Discover the results follow the typing, and Back returns to the rows", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    await settle(page);
    await search(page).fill("dune");
    // No Enter: the address changes once the typing pauses.
    await expect.poll(() => address(page)).toBe("/discover?q=dune");
    await expect(results(page).getByRole("listitem")).toHaveCount(2);
    await expect(search(page)).toBeFocused();

    // Refining rewrites the same history entry.
    await search(page).fill("dune: part");
    await expect.poll(() => address(page)).toBe("/discover?q=dune%3A+part");
    await expect(results(page).getByRole("listitem")).toHaveCount(1);
    await expect(search(page)).toHaveValue("dune: part");
    // The reader's own tie to a title, and how much of a series can be played.
    await search(page).fill("severance");
    await expect(
      results(page).getByRole("link", {
        name: "Severance 9 of 19 episodes Series, 2022 You follow this",
      }),
    ).toBeVisible();
    await search(page).fill("dune: part");
    await expect.poll(() => address(page)).toBe("/discover?q=dune%3A+part");

    await page.reload();
    await settle(page);
    await expect(search(page)).toHaveValue("dune: part");
    await expect(results(page).getByRole("listitem")).toHaveCount(1);

    await page.goBack();
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(search(page)).toHaveValue("");
    await expect(rail(page, ROWS[0])).toBeVisible();

    // Emptying the field is a search for nothing: the rows come back.
    await search(page).fill("dune");
    await expect.poll(() => address(page)).toBe("/discover?q=dune");
    await search(page).fill("");
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(rail(page, ROWS[0])).toBeVisible();
  });

  test("a search that finds nothing says so and what to try", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover?q=zzzz");
    await settle(page);
    await expect(
      page.getByRole("heading", { name: "No titles match" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("No titles match “zzzz”");
    expect(await violationDetails(page)).toEqual([]);
  });
});

test.describe("one feed", () => {
  test("See all opens the feed at its own address, a page at a time", async ({
    page,
  }) => {
    await openAs(page, "member", "/discover");
    await settle(page);
    await page.getByRole("link", { name: "See all: Popular films" }).click();
    await expect.poll(() => address(page)).toBe("/discover/popular-films");
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Popular films",
    });
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle("Popular films · Media");
    const cards = rail(page, "Popular films").getByRole("listitem");
    // The row had already read the first page.
    await expect(cards).toHaveCount(20);
    await page.getByRole("button", { name: "Show more titles" }).click();
    await expect(cards).toHaveCount(40);
    await page.getByRole("button", { name: "Show more titles" }).click();
    await expect(cards).toHaveCount(54);
    await expect(
      page.getByRole("button", { name: "Show more titles" }),
    ).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);

    await page.reload();
    await settle(page);
    await expect(heading).toBeVisible();
    await page
      .getByRole("link", { name: "Discover", exact: true })
      .first()
      .click();
    await expect.poll(() => address(page)).toBe("/discover");
  });

  test("an address that names no feed opens the rows", async ({ page }) => {
    await openAs(page, "member", "/discover/no-such-list");
    await expect.poll(() => address(page)).toBe("/discover");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Discover",
    );
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`when the catalog is in trouble, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("one feed that is down fails in its own row, and can be tried again", async ({
      page,
    }) => {
      await inScenario(page, "feed-unavailable");
      await openAs(page, "member", "/discover");
      await settle(page);
      const failure = page.getByRole("alert");
      await expect(failure).toHaveCount(1);
      await expect(
        failure.getByRole("heading", { name: `${DOWN} did not load` }),
      ).toBeVisible();
      await expect(failure).toContainText("Your library is not affected.");
      // Every other row is there, and so is search.
      for (const row of ROWS.filter((title) => title !== DOWN)) {
        await expect(rail(page, row).getByRole("listitem")).toHaveCount(20);
      }
      await expect(rail(page, DOWN)).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: `See all: ${DOWN}` }),
      ).toHaveCount(0);
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);

      const rows = page.locator("#main section");
      const failed = await rows.evaluateAll((sections) =>
        sections.map((section) =>
          Math.round(section.getBoundingClientRect().height),
        ),
      );
      await inScenario(page, "default");
      await failure.getByRole("button", { name: "Try again" }).click();
      await expect(rail(page, DOWN).getByRole("listitem")).toHaveCount(20);
      await expect(page.getByRole("alert")).toHaveCount(0);
      // The row was holding the room its rail takes.
      const recovered = await rows.evaluateAll((sections) =>
        sections.map((section) =>
          Math.round(section.getBoundingClientRect().height),
        ),
      );
      expect(recovered).toEqual(failed);

      await inScenario(page, "feed-unavailable");
      await search(page).fill("the");
      await search(page).press("Enter");
      await expect(results(page).getByRole("listitem")).toHaveCount(20);
    });

    test("a catalog that is down altogether is explained once", async ({
      page,
    }) => {
      await inScenario(page, "catalog-unavailable");
      await openAs(page, "member", "/discover");
      const failure = page.getByRole("alert");
      await expect(failure).toHaveCount(1);
      await expect(
        failure.getByRole("heading", { name: "Discover did not load" }),
      ).toBeVisible();
      expect(await violationDetails(page)).toEqual([]);

      await inScenario(page, "default");
      await failure.getByRole("button", { name: "Try again" }).click();
      for (const row of ROWS) {
        await expect(rail(page, row).getByRole("listitem")).toHaveCount(20);
      }

      await inScenario(page, "catalog-unavailable");
      await page.goto("/discover?q=the");
      await expect(
        page
          .getByRole("alert")
          .getByRole("heading", { name: "The search did not load" }),
      ).toBeVisible();
      expect(await violationDetails(page)).toEqual([]);
    });

    test("library access that could not be confirmed is said once, and no title is called missing", async ({
      page,
    }) => {
      await inScenario(page, "stale-library-access");
      await openAs(page, "member", "/discover");
      await settle(page);
      const notice = page.getByRole("region", {
        name: "Media could not confirm your Plex access just now",
      });
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText(
        "Discover does not show what your household already has",
      );
      for (const row of ROWS) {
        await expect(rail(page, row).getByRole("listitem")).toHaveCount(20);
      }
      // Nothing is offered as missing, and nothing claims a state.
      const main = page.locator("#main");
      await expect(main.getByText("Request", { exact: true })).toHaveCount(0);
      await expect(main.getByText("Ready to watch")).toHaveCount(0);
      await expect(
        rail(page, ROWS[0]).getByRole("link", {
          name: "The Wire Series, 2002",
          exact: true,
        }),
      ).toHaveAttribute("href", /^\/catalog\/series\/\d+$/u);
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);

      // The same holds for a search and for one whole feed.
      await page.goto("/discover?q=the");
      await settle(page);
      await expect(notice).toHaveCount(1);
      await expect(results(page).getByRole("listitem")).toHaveCount(20);
      await expect(main.getByText("Request", { exact: true })).toHaveCount(0);
      await page.goto("/discover/popular-films");
      await settle(page);
      await expect(notice).toHaveCount(1);
      await expect(main.getByText("Request", { exact: true })).toHaveCount(0);

      // Once access is confirmed again, asking again fills the states in.
      await inScenario(page, "default");
      await notice.getByRole("button", { name: "Check again" }).click();
      await expect(notice).toHaveCount(0);
      await expect(
        main.getByText("Request", { exact: true }).first(),
      ).toBeVisible();
    });

    test("it is said over a search that finds nothing, too", async ({
      page,
    }) => {
      await inScenario(page, "stale-library-access");
      await openAs(page, "member", "/discover?q=zzzz");
      await settle(page);
      const nothing = page.getByRole("heading", { name: "No titles match" });
      await expect(nothing).toBeVisible();
      // No title carried the news, so the page itself has to.
      const notice = page.getByRole("region", {
        name: "Media could not confirm your Plex access just now",
      });
      await expect(notice).toHaveCount(1);
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);

      // With access confirmed, a search that finds nothing is only that.
      await inScenario(page, "default");
      await notice.getByRole("button", { name: "Check again" }).click();
      await expect(notice).toHaveCount(0);
      await expect(nothing).toBeVisible();
    });
  });
}
