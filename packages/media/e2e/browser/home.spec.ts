import { expect, type Locator, type Page } from "@playwright/test";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import { requestId } from "#testing/fixture-api/fixtures/requests.ts";
import { list, main, sectionHeadings, SECTIONS } from "./home-page.ts";
import {
  address,
  allowWrites,
  horizontalOverflow,
  inScenario,
  openAs,
  settle,
  test,
  violationDetails,
} from "./support.ts";

/*
 * Home: the six sections for a member and for the owner, the welcome a
 * household with nothing gets, one section failing among the others, and
 * the two things that are answered on the page itself. Runs at both
 * viewports; the route suite (`smoke.spec.ts`) opens `/` for both personas
 * in both color schemes as well, and `home-loading.spec.ts` has the page
 * while its reads are out.
 */

/** The item of a list whose heading is exactly `name`. */
function item(items: Locator, name: string): Locator {
  return items.getByRole("listitem").filter({
    has: items.page().getByRole("heading", { name, exact: true }),
  });
}

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

/** Every API read the page makes, as `path?query`, in the order asked. */
function watchReads(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/api/v1/artwork/")
    ) {
      reads.push(`${url.pathname}${url.search}`);
    }
  });
  return reads;
}

test.describe("a member's Home", () => {
  test("has every section, each showing what its read holds", async ({
    page,
  }) => {
    await openAs(page, "member", "/");
    await settle(page);
    await expect(page).toHaveTitle("Home · Media");
    await expect(sectionHeadings(page)).toHaveText([...SECTIONS]);

    // The checks waiting on the reader, the one due soonest first.
    const needs = list(page, "Needs your answer");
    await expect(needs.getByRole("heading")).toHaveText([
      "Shōgun",
      "Slow Horses",
      "The Bear",
    ]);
    const shogun = item(needs, "Shōgun");
    await expect(shogun).toContainText(/Still watching\? Answer by [A-Z]/u);
    await expect(shogun.getByRole("button")).toHaveText([
      "Keep watching",
      "I have finished it",
      "Stop following",
    ]);
    await expect(shogun.getByRole("link", { name: "Shōgun" })).toHaveAttribute(
      "href",
      `/media/${titleNamed("Shōgun").id}`,
    );
    // What a restore left to decide is the owner's alone.
    await expect(needs).not.toContainText(/review|restore/iu);

    // Their own stream, linked to its series.
    const playing = list(page, "Now playing");
    await expect(playing.getByRole("listitem")).toHaveCount(1);
    await expect(
      playing.getByRole("link", { name: "Severance" }),
    ).toHaveAttribute("href", `/media/${titleNamed("Severance").id}`);
    await expect(playing).toContainText("On Apple TV");
    await expect(
      playing.getByRole("progressbar", {
        name: "How far Severance has played",
      }),
    ).toBeVisible();

    // What they asked for that is still arriving, in plain words.
    const way = list(page, "On the way");
    await expect(way.getByRole("listitem")).toHaveCount(6);
    await expect(item(way, "Andor")).toContainText("Adding it to the library");
    await expect(item(way, "Anora")).toContainText("Looking for it");
    // Princess Mononoke is being acquired and its request is still active,
    // but the reader stopped following it. Further along than most, it would
    // be among these six if the interest were ignored.
    await expect(
      way.getByRole("heading", { name: "Princess Mononoke" }),
    ).toHaveCount(0);

    // The library's newest, as posters from the artwork route.
    const added = list(page, "New in the library");
    await expect(added.getByRole("listitem")).toHaveCount(20);
    await expect(added.getByRole("listitem").first()).toContainText(
      /Added [A-Z][a-z]{2} \d{1,2}/u,
    );
    await expect(added.locator("img").first()).toHaveAttribute(
      "srcset",
      /\/api\/v1\/artwork\/w185\//u,
    );

    // The week ahead starts today, whatever day of the month that is.
    // Each release is the Calendar's own row, linked to its title's page.
    const today = list(page, "Today");
    await expect(today.getByRole("listitem").first()).toBeVisible();
    await expect(today.getByRole("link").first()).toHaveAttribute(
      "href",
      /^\/media\/[\da-f-]{36}$/u,
    );
    await expect(
      today.locator("img, [aria-hidden='true']").first(),
    ).toBeVisible();

    // The three that leave first, each with its hold.
    const leaving = list(page, "Leaving soon");
    await expect(leaving.getByRole("heading")).toHaveText([
      "Get Out",
      "The Expanse",
      "Mr. Robot",
    ]);
    await expect(
      item(leaving, "Get Out").getByRole("button", {
        name: "Keep for 30 days",
      }),
    ).toBeVisible();
    await expect(
      item(leaving, "The Expanse").getByRole("button", {
        name: "Keep all 4 episodes",
      }),
    ).toBeVisible();

    // No member sees a contract value.
    await expect(main(page)).not.toContainText(
      /awaiting|grace|quarantin|transcode|direct play|validating|importing|_/iu,
    );
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("each “See all” opens the page that has the rest", async ({ page }) => {
    for (const [name, to] of [
      ["See all: everything you asked for", "/library/mine"],
      ["See all: New in the library", "/library?sort=added"],
      ["See all: the calendar", "/calendar"],
      ["See all 6: Leaving soon", "/library/leaving"],
    ] as const) {
      await openAs(page, "member", "/");
      await settle(page);
      await main(page).getByRole("link", { name, exact: true }).click();
      await expect.poll(() => address(page)).toBe(to);
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    }
  });

  test("asks for each list once, and shares the library's answer with the Library", async ({
    page,
  }) => {
    const reads = watchReads(page);
    await openAs(page, "member", "/");
    await settle(page);
    const paths = reads.map((read) => new URL(read, "http://media").pathname);
    expect(paths.toSorted(byName)).toEqual(
      [
        "/api/v1/me",
        // The bell in the top bar, for its unread count: the shell's, not Home's.
        "/api/v1/notifications",
        "/api/v1/requests",
        // The reader's interests are two pages long.
        "/api/v1/request-interests",
        "/api/v1/request-interests",
        "/api/v1/playback/now-playing",
        "/api/v1/library",
        "/api/v1/calendar",
        "/api/v1/removals",
        // One read for every leaving title's hold, not one each.
        "/api/v2/targets/default",
      ].toSorted(byName),
    );

    // The Library sorted the same way shows the answer Home already has.
    await main(page)
      .getByRole("link", { name: "See all: New in the library" })
      .click();
    await expect(
      page.getByRole("list", { name: "Library titles" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(
      reads.filter((read) => read.startsWith("/api/v1/library?")),
    ).toHaveLength(1);
  });
});

test.describe("the owner's Home", () => {
  test("adds what a restore left to decide, and the household's streams", async ({
    page,
  }) => {
    const reads = watchReads(page);
    await openAs(page, "owner", "/");
    await settle(page);
    await expect(sectionHeadings(page)).toHaveText([...SECTIONS]);
    expect(
      reads.filter((read) => read.startsWith("/api/v1/recovery")),
    ).toHaveLength(1);

    const needs = list(page, "Needs your answer");
    await expect(needs.getByRole("heading")).toHaveText([
      "Shōgun",
      "Slow Horses",
      "The Bear",
      "A household review is open",
      "6 titles are held after a restore",
    ]);
    const review = item(needs, "A household review is open");
    await expect(review).toContainText(
      "Breaking Bad and Better Call Saul stay protected",
    );
    await expect(
      review.getByRole("link", { name: "Open the review" }),
    ).toHaveAttribute("href", /^\/recovery\/[\da-f-]{36}$/u);
    await item(needs, "6 titles are held after a restore")
      .getByRole("link", { name: "Review held titles" })
      .click();
    await expect.poll(() => address(page)).toBe("/recovery");
    await expect(
      page.getByRole("heading", { level: 1, name: "Recovery protection" }),
    ).toBeFocused();

    await page.goBack();
    const playing = list(page, "Now playing");
    await expect(playing.getByRole("heading")).toHaveText([
      "Severance",
      "Spirited Away",
    ]);
    await expect(item(playing, "Spirited Away")).toContainText(
      "Kids, on LG webOS",
    );
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe("answered on the page", () => {
  test("a check is answered with one press and says so where it stood", async ({
    page,
  }) => {
    await openAs(page, "member", "/");
    await settle(page);
    await allowWrites(page);
    const commands: unknown[] = [];
    await page.route(
      /\/api\/v1\/request-interests\/[^/]+\/commands$/u,
      async (route) => {
        commands.push(route.request().postDataJSON());
        await route.fulfill({
          json: {
            schemaVersion: 1,
            requestId: requestId(3),
            version: 5,
            interestRevision: 1,
            state: "following",
            keepingPolicy: "temporary",
          },
        });
      },
    );
    const needs = list(page, "Needs your answer");
    const shogun = item(needs, "Shōgun");
    const keep = shogun.getByRole("button", { name: "Keep watching" });
    await keep.focus();
    await page.keyboard.press("Enter");
    await expect(shogun.getByRole("status")).toHaveText(
      "You are still watching this.",
    );
    expect(commands).toEqual([
      expect.objectContaining({ requestId: requestId(3), action: "continue" }),
    ]);
    // The answer took the buttons' place, and focus with them.
    await expect(shogun.getByRole("button")).toHaveCount(0);
    await expect(shogun.getByRole("status")).toBeFocused();
    // It keeps its place among the checks still waiting.
    await expect(needs.getByRole("heading")).toHaveText([
      "Shōgun",
      "Slow Horses",
      "The Bear",
    ]);
    await expect(
      item(needs, "The Bear").getByRole("button", { name: "Keep watching" }),
    ).toBeEnabled();
    expect(await violationDetails(page)).toEqual([]);
  });

  test("an answer the server refuses is said beside the check, which stays", async ({
    page,
  }) => {
    await openAs(page, "member", "/");
    await settle(page);
    await allowWrites(page);
    // The fixture API refuses every write, as a server that is down would.
    const shogun = item(list(page, "Needs your answer"), "Shōgun");
    await shogun.getByRole("button", { name: "Stop following" }).click();
    await expect(shogun.getByRole("alert")).toContainText(
      "this change was not saved",
    );
    await expect(
      shogun.getByRole("button", { name: "Keep watching" }),
    ).toBeEnabled();
    // The refused write is this test's own doing.
    await expect(sectionHeadings(page)).toHaveText([...SECTIONS]);
  });

  test("a leaving title is kept for 30 days with one press", async ({
    page,
  }) => {
    await openAs(page, "member", "/");
    await settle(page);
    await allowWrites(page);
    const kept: string[] = [];
    await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
      const mediaId =
        new URL(route.request().url()).pathname.split("/")[4] ?? "";
      kept.push(mediaId);
      expect(route.request().postDataJSON()).toMatchObject({
        scope: { mediaId, edition: "default" },
        command: { action: "keep" },
      });
      await route.fulfill({
        json: {
          schemaVersion: 2,
          scope: { mediaId, edition: "default" },
          result: { status: "completed" },
          appliedVersions: { mediaVersion: 2, targetVersion: 5 },
        },
      });
    });
    const getOut = item(list(page, "Leaving soon"), "Get Out");
    await getOut.getByRole("button", { name: "Keep for 30 days" }).click();
    await expect(getOut.getByRole("status")).toHaveText("Saved");
    expect(kept).toEqual([titleNamed("Get Out").id]);

    // A series losing several episodes is kept in one action, as in the
    // Library, and the report of it stays until the reader dismisses it.
    const expanse = item(list(page, "Leaving soon"), "The Expanse");
    await expanse.getByRole("button", { name: "Keep all 4 episodes" }).click();
    await expect(expanse.getByRole("status").first()).toHaveText(
      "Kept all 4 episodes for 30 days.",
    );
    expect(kept).toHaveLength(5);
    await expect(
      expanse.getByRole("button", { name: /Keep all/u }),
    ).toHaveCount(0);
    await expanse.getByRole("button", { name: "Dismiss this report" }).click();
    await expect(
      expanse.getByRole("button", { name: "Keep all 4 episodes" }),
    ).toBeVisible();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`on a ${scheme} device`, () => {
    test.use({ colorScheme: scheme });

    test("a household with nothing yet is welcomed and pointed to Discover", async ({
      page,
    }) => {
      await inScenario(page, "new-household");
      for (const persona of ["member", "owner"] as const) {
        await openAs(page, persona, "/");
        await settle(page);
        await expect(sectionHeadings(page)).toHaveText([
          persona === "member" ? "Welcome, Mei" : "Welcome, Robin",
        ]);
      }
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
      await main(page)
        .getByRole("link", { name: "Find something to watch" })
        .click();
      await expect.poll(() => address(page)).toBe("/discover");
      await expect(
        page.getByRole("heading", { level: 1, name: "Discover" }),
      ).toBeFocused();
    });

    test("one read failing leaves the other sections standing, and can be asked again", async ({
      page,
    }) => {
      await inScenario(page, "library-unavailable");
      await openAs(page, "member", "/");
      await settle(page);
      // Every section is still on the page, the failed one included.
      await expect(sectionHeadings(page)).toHaveText([...SECTIONS]);
      const failure = main(page).locator('[data-ui="error-state"]');
      await expect(failure).toHaveCount(1);
      await expect(
        failure.getByRole("heading", {
          level: 3,
          name: "What is new in the library did not load",
        }),
      ).toBeVisible();
      await expect(failure).toContainText(
        "Media ran into a problem on its side.",
      );
      await expect(list(page, "Leaving soon").getByRole("heading")).toHaveCount(
        3,
      );
      await expect(list(page, "On the way").getByRole("listitem")).toHaveCount(
        6,
      );
      // “See all” would open a list that has just failed to load.
      await expect(
        main(page).getByRole("link", { name: "See all: New in the library" }),
      ).toHaveCount(0);
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);

      // The library answers again: the section fills in where it failed.
      await inScenario(page, "default");
      await failure.getByRole("button", { name: "Try again" }).click();
      await expect(
        list(page, "New in the library").getByRole("listitem"),
      ).toHaveCount(20);
      await expect(failure).toHaveCount(0);
    });
  });
}
