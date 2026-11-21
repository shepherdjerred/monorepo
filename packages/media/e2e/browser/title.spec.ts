import { expect } from "@playwright/test";
import {
  FEATURED,
  episodeId,
  seasonId,
  titleNamed,
} from "#testing/fixture-api/fixtures/titles.ts";
import {
  horizontalOverflow as overflow,
  openAs,
  openSettled as open,
  test,
  violationDetails,
} from "./support.ts";

/*
 * The title page, for a film or series the household has (`/media/:id`) and
 * for one it does not (`/catalog/:kind/:id`), and the request sheet it
 * opens. Runs at both viewports; the smoke suite already loads every one of
 * these routes in both themes and checks them with axe.
 */

const movie = FEATURED.movie;
const series = FEATURED.series;
/** A film and a series the household does not have. */
const CATALOG_MOVIE = "/catalog/movie/155";
const CATALOG_SERIES = "/catalog/series/1398";

const mediaPath = (id: string) => `/media/${id}`;

/** Words that belong to the owner's tools, never to a member's page. */
const SYSTEM_VOCABULARY =
  /seeding|share ratio|acquisition|unmarked|quality profile|release decision|policy|_/iu;

test.describe("a film the household has", () => {
  test("a member sees the title, where it stands, and one thing to do", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(movie.id));
    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      movie.title,
    );
    await expect(main.getByText("Ready to watch").first()).toBeVisible();
    await expect(main.getByText(/Paul Atreides unites/u)).toBeVisible();

    // The backdrop is the one image fetched at high priority; the poster is
    // not deferred; both sit in frames that hold their place.
    const images = main.locator("header img");
    await expect(images).toHaveCount(2);
    const backdrop = images.first();
    await expect(backdrop).toHaveAttribute("fetchpriority", "high");
    await expect(backdrop).toHaveAttribute(
      "srcset",
      /\/api\/v1\/artwork\/w1280\//u,
    );
    await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);
    const poster = images.nth(1);
    await expect(poster).toHaveAttribute("loading", "eager");
    const box = await poster.boundingBox();
    if (box === null) throw new Error("The poster has no box");
    expect(box.height / box.width).toBeCloseTo(1.5, 1);

    // One state-driven control: the member follows this film.
    const following = main.getByRole("button", { name: "Following" });
    await expect(following).toHaveAttribute("aria-expanded", "false");
    await following.click();
    await expect(
      main.getByRole("button", { name: /^Stop following/u }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: /^Request another version/u }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(following).toBeFocused();
    await expect(following).toHaveAttribute("aria-expanded", "false");

    // The household's side of it, in a member's words.
    const household = main
      .getByRole("heading", { name: "In your household" })
      .locator("..");
    await expect(household).toContainText("You");
    // A member is told about their own request and nobody else's.
    await expect(household).not.toContainText("Sam");

    // Nothing of the owner's tools: no switch to them, no empty shells.
    await expect(
      page.getByRole("navigation", { name: "Title views" }),
    ).toHaveCount(0);
    await expect(main).not.toContainText(SYSTEM_VOCABULARY);
    expect(await overflow(page)).toBe(0);
  });

  test("files and subtitles stay closed until asked for", async ({ page }) => {
    await open(page, "member", mediaPath(movie.id));
    const files = page.getByText("Files and subtitles");
    await expect(page.getByText("The copy you watch")).toBeHidden();
    await files.click();
    await expect(page.getByText("The copy you watch")).toBeVisible();
    await expect(page.getByText(/Subtitles: English/u)).toBeVisible();
    await expect(
      page.getByText(/still looking for Chinese \(Simplified\)/u),
    ).toBeVisible();
    expect(await violationDetails(page)).toEqual([]);
  });

  test("the owner sees who follows it and opens Manage on demand", async ({
    page,
  }) => {
    const manageCode: string[] = [];
    page.on("request", (request) => {
      if (/\/assets\/manage-[\w-]+\.js$/u.test(request.url())) {
        manageCode.push(request.url());
      }
    });
    await open(page, "owner", mediaPath(movie.id));
    const main = page.getByRole("main");
    await expect(main.getByText("You, Sam")).toBeVisible();
    await expect(main.getByText("Kept for good")).toBeVisible();
    await expect(main).not.toContainText(SYSTEM_VOCABULARY);
    // The owner's tools are not part of the page until they are opened.
    expect(manageCode).toEqual([]);

    const views = page.getByRole("navigation", { name: "Title views" });
    await views.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/\?view=manage$/u);
    await expect(views.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "Title history" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(manageCode).toHaveLength(1);
    // Today's operator panels, as they were.
    for (const name of [
      "Unmarked edition download & seeding",
      "Manage a movie edition",
      "Unmarked edition in your library",
      "Unmarked edition files & subtitles",
    ]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(page.getByLabel("Quality profile")).toBeVisible();
    expect(await violationDetails(page)).toEqual([]);
    expect(await overflow(page)).toBe(0);

    await views.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(new RegExp(`${movie.id}$`, "u"));
    await expect(
      page.getByRole("heading", { name: "In your household" }),
    ).toBeVisible();
  });

  test("a member who opens the Manage address gets the member's page", async ({
    page,
  }) => {
    await open(page, "member", `${mediaPath(movie.id)}?view=manage`);
    await expect(
      page.getByRole("heading", { name: "In your household" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Title history" }),
    ).toHaveCount(0);
  });

  test("a film with several versions lists each with its own standing", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(titleNamed("Blade Runner").id));
    const versions = page
      .getByRole("heading", { name: "Versions" })
      .locator("..");
    await expect(versions.getByRole("listitem")).toHaveCount(2);
    const standard = versions.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Standard version" }),
    });
    await expect(standard).toContainText("Ready to watch");
    const finalCut = versions.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: "Final cut" }),
    });
    await expect(finalCut).toContainText("Not found yet");
    await expect(finalCut).toContainText(
      "You asked for this: looking for this version.",
    );
    await finalCut
      .getByRole("button", { name: "Actions for Final cut" })
      .click();
    await expect(
      finalCut.getByRole("button", { name: /^Stop following/u }),
    ).toBeVisible();
    expect(await violationDetails(page)).toEqual([]);
  });
});

test.describe("a series the household has", () => {
  test("seasons open onto episodes, each with its state in plain words", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    const main = page.getByRole("main");
    await expect(main.getByText("16 of 19 episodes")).toBeVisible();
    await expect(main.getByText("63% downloaded")).toBeVisible();

    const episodes = page.getByRole("list", { name: "Season 2 episodes" });
    await expect(episodes).toBeHidden();
    // A season is a native disclosure: it opens from the keyboard.
    const season = page.locator("summary").filter({ hasText: "Season 2" });
    await season.focus();
    await page.keyboard.press("Enter");
    await expect(episodes.getByRole("listitem")).toHaveCount(10);
    await expect(episodes.getByRole("listitem").first()).toContainText(
      "Ready to watch",
    );
    await expect(episodes).toContainText("On the way");
    await expect(episodes).not.toContainText(SYSTEM_VOCABULARY);
    expect(await violationDetails(page)).toEqual([]);
    expect(await overflow(page)).toBe(0);

    await episodes
      .getByRole("link", { name: "Episode 1: Hello, Ms. Cobel" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${episodeId(series, 2, 1)}$`, "u"),
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Hello, Ms. Cobel",
    );
  });

  test("a season and an episode show the series' art and link up to it", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(seasonId(series, 2)));
    const header = page.getByRole("main").locator("header");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Season 2",
    );
    await expect(header.locator("img")).toHaveCount(2);
    await expect(
      page
        .getByRole("list", { name: "Season 2 episodes" })
        .getByRole("listitem"),
    ).toHaveCount(10);
    await header.getByRole("link", { name: series.title }).click();
    await expect(page).toHaveURL(new RegExp(`${series.id}$`, "u"));

    await open(page, "member", mediaPath(episodeId(series, 1, 3)));
    const trail = page.getByRole("main").locator("header");
    await expect(trail.getByRole("link", { name: series.title })).toBeVisible();
    await expect(trail.getByText("Season 1, episode 3")).toBeVisible();
    await trail.getByRole("link", { name: "Season 1", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${seasonId(series, 1)}$`, "u"));
    expect(await violationDetails(page)).toEqual([]);
  });

  test("the owner's Manage view keeps the release decisions", async ({
    page,
  }) => {
    await open(page, "owner", `${mediaPath(series.id)}?view=manage`);
    for (const name of [
      "Download & seeding",
      "In your library",
      "Release decisions",
      "Title history",
    ]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Retry acquisition" }),
    ).toBeVisible();
  });
});

test.describe("a title the household does not have", () => {
  for (const [path, heading] of [
    [CATALOG_MOVIE, "The Dark Knight"],
    [CATALOG_SERIES, "The Sopranos"],
  ] as const) {
    test(`${heading} can only be asked for`, async ({ page }) => {
      await open(page, "member", path);
      const main = page.getByRole("main");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(main.getByText("Not in the library")).toBeVisible();
      await expect(
        main.getByText("Nobody in your household has asked for this yet."),
      ).toBeVisible();
      await expect(
        main.getByRole("button", { name: "Request", exact: true }),
      ).toBeVisible();
      expect(await overflow(page)).toBe(0);
    });
  }

  test("a catalog address of a title the household has opens its own page", async ({
    page,
  }) => {
    await open(page, "member", `/catalog/movie/${String(movie.tmdbId)}`);
    await expect(page).toHaveURL(new RegExp(`/media/${movie.id}$`, "u"));
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  });
});

test.describe("a title that cannot be shown", () => {
  test("one that does not exist says so and offers the ways out", async ({
    page,
  }) => {
    await openAs(page, "member", "/media/00000002-0000-4000-8000-00000000ffff");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This title is not here",
    );
    await expect(
      page.getByRole("link", { name: "Go to the Library" }),
    ).toBeVisible();
    expect(await violationDetails(page)).toEqual([]);
    await openAs(page, "member", "/catalog/movie/999999999");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This title is not here",
    );
    await openAs(page, "member", "/catalog/person/12");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This title is not here",
    );
  });

  test("one the reader may not open says that instead", async ({ page }) => {
    await page.route(/\/targets\/default$/u, async (route) => {
      await route.fulfill({
        status: 403,
        json: {
          error: {
            code: "forbidden",
            message: "No authorized command context for this target",
          },
        },
      });
    });
    await openAs(page, "member", mediaPath(movie.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "You cannot open this title",
    );
    await expect(page.getByRole("main")).not.toContainText("command context");
    expect(await violationDetails(page)).toEqual([]);
  });

  test("a read that fails can be tried again", async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/v1\/media\/[^/]+$/u, async (route) => {
      if (!fail) return route.fallback();
      await route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "Database is down" } },
      });
    });
    await openAs(page, "member", mediaPath(movie.id));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "This title did not load",
    );
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      movie.title,
    );
  });
});

test.describe("the way back", () => {
  test("goes to wherever the reader came from", async ({ page }) => {
    await open(page, "member", "/library?kind=series");
    await page
      .getByRole("list", { name: "Library titles" })
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/media\//u);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Back", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library\?kind=series$/u);
  });

  test("goes to the Library when there is nowhere to go back to", async ({
    page,
  }) => {
    // As from an email or a notification: the page is the tab's first.
    await open(page, "member", mediaPath(series.id));
    await page
      .getByRole("main")
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library$/u);
  });
});
