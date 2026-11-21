import { expect, type Page } from "@playwright/test";
import { list, main, sectionHeadings, SECTIONS } from "./home-page.ts";
import { inScenario, openAs, settle, test } from "./support.ts";

/*
 * Home while its reads are out: which sections hold their place and which
 * take none, and a welcome that waits for every answer. Runs at both
 * viewports.
 */

/**
 * Holds the answers to the reads `held` matches until `release` is called,
 * and counts how many are being held. Reads made after the release are
 * answered as they come.
 */
async function hold(page: Page, held: RegExp) {
  const waiting: (() => void)[] = [];
  let released = false;
  await page.route(held, async (route) => {
    if (!released) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    await route.continue();
  });
  return {
    asked: () => waiting.length,
    release: () => {
      released = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

test.describe("while it loads", () => {
  test("a section still loading holds the room its content takes", async ({
    page,
  }) => {
    // The library's answer is held back until the test lets it go.
    let release: () => void = () => {
      throw new Error("The library was never asked");
    };
    await page.route(/\/api\/v1\/library\?/u, async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    await openAs(page, "member", "/");
    const loading = main(page)
      .getByRole("status")
      .filter({ hasText: "Loading what is new" });
    await expect(loading).toBeVisible();
    // The other sections did not wait for it: all five have their content.
    for (const name of ["Needs your answer", "Now playing", "On the way"]) {
      await expect(list(page, name)).toBeVisible();
    }
    await expect(list(page, "Today")).toBeVisible();
    await expect(list(page, "Leaving soon")).toBeVisible();
    await expect(
      main(page).getByRole("status").filter({ hasText: "Loading" }),
    ).toHaveCount(1);
    const below = page.getByRole("heading", { level: 2, name: "This week" });
    const before = await below.boundingBox();
    release();
    await expect(list(page, "New in the library")).toBeVisible();
    await expect(loading).toHaveCount(0);
    const after = await below.boundingBox();
    if (before === null || after === null) throw new Error("No heading box");
    // What stood below the rail stays where it was, to within a line of a
    // long title's wrapping.
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(24);
  });

  test("the sections that are usually empty take no room, and appear when they have something", async ({
    page,
  }) => {
    const quiet = await hold(
      page,
      /\/api\/v1\/(request-interests|playback\/now-playing)/u,
    );
    await openAs(page, "member", "/");
    const usual = SECTIONS.filter(
      (name) => name !== "Needs your answer" && name !== "Now playing",
    );
    // The four that usually have content are in, and nothing stands in for
    // the two whose reads are still out: no heading and no placeholder.
    await expect(list(page, "Leaving soon")).toBeVisible();
    await expect(list(page, "On the way")).toBeVisible();
    await expect(list(page, "New in the library")).toBeVisible();
    await expect.poll(quiet.asked).toBe(2);
    await expect(sectionHeadings(page)).toHaveText(usual);
    await expect(
      main(page).getByRole("status").filter({ hasText: "Loading" }),
    ).toHaveCount(0);
    await expect(main(page).getByText("Welcome,")).toHaveCount(0);

    quiet.release();
    await expect(list(page, "Needs your answer")).toBeVisible();
    await expect(list(page, "Now playing")).toBeVisible();
    await expect(sectionHeadings(page)).toHaveText([...SECTIONS]);
  });

  test("the welcome waits until every read has answered", async ({ page }) => {
    await inScenario(page, "new-household");
    // The two reads no placeholder stands in for: with every other read
    // already answered empty, nothing on the page says they are still out.
    const quiet = await hold(
      page,
      /\/api\/v1\/(request-interests|playback\/now-playing)/u,
    );
    await openAs(page, "member", "/");
    await expect.poll(quiet.asked).toBe(2);
    // The four sections that hold their place have had their answers.
    await expect(
      main(page).getByRole("status").filter({ hasText: "Loading" }),
    ).toHaveCount(0);
    // Nothing has been found, but nothing is known to be missing yet.
    await expect(sectionHeadings(page)).toHaveCount(0);
    await expect(main(page).getByText("Welcome,")).toHaveCount(0);

    quiet.release();
    await expect(
      page.getByRole("heading", { level: 2, name: "Welcome, Mei" }),
    ).toBeVisible();
  });

  test("the welcome is not shown over a read that failed", async ({ page }) => {
    await inScenario(page, "new-household");
    await page.route(/\/api\/v1\/playback\/now-playing/u, (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "internal_error", message: "The read broke" } },
      }),
    );
    await openAs(page, "member", "/");
    await settle(page);
    await expect(sectionHeadings(page)).toHaveText(["Now playing"]);
    await expect(
      main(page).getByRole("heading", {
        level: 3,
        name: "What is playing did not load",
      }),
    ).toBeVisible();
    await expect(main(page).getByText("Welcome,")).toHaveCount(0);
  });
});
