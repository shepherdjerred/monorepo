import { expect, type Page } from "@playwright/test";
import { FEATURED } from "#testing/fixture-api/fixtures/titles.ts";
import {
  address,
  openAs,
  openSettled,
  settle,
  test,
  watchForFailures,
} from "#e2e/browser/support.ts";

/*
 * The poster that travels from a card to its title page and back. A view
 * transition is motion, so the page's own transition API is watched instead
 * of its pixels: every `startViewTransition` call is recorded with how many
 * elements carried the name when it began, whether the browser accepted the
 * pair (a second carrier ends it), and whether the poster's own animation
 * ran. The stylesheet's module scopes the name (`<hash>_title-poster`), so it
 * is recognized by its end.
 */

type Recorded = {
  carriers: number;
  ready: boolean | null;
  finished: boolean;
  poster: boolean;
  /** How many elements carried the name once the new page was in. */
  after: number;
  /** The link the first of them sits in: the card the poster lands on. */
  landedOn: string | null;
};

declare global {
  // Set by `watchTransitions`, read back by `recorded`.
  var viewTransitionLog: Recorded[] | undefined;
}

/** Records every view transition the page starts. */
async function watchTransitions(page: Page) {
  await page.addInitScript(() => {
    const log: Recorded[] = [];
    globalThis.viewTransitionLog = log;
    const carriersNow = () =>
      [...globalThis.document.querySelectorAll("*")].filter((element) =>
        globalThis
          .getComputedStyle(element)
          .viewTransitionName.endsWith("title-poster"),
      ).length;
    const carrierNow = () =>
      [...globalThis.document.querySelectorAll("*")].find((element) =>
        globalThis
          .getComputedStyle(element)
          .viewTransitionName.endsWith("title-poster"),
      );
    const carriesPosterAnimation = () =>
      globalThis.document
        .getAnimations()
        .some(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.pseudoElement?.startsWith(
              "::view-transition-group(",
            ) === true &&
            animation.effect.pseudoElement.endsWith("title-poster)"),
        );
    async function follow(transition: ViewTransition, record: Recorded) {
      try {
        await transition.ready;
        record.ready = true;
        record.poster = carriesPosterAnimation();
        record.after = carriersNow();
        record.landedOn = carrierNow()?.closest("a")?.textContent ?? null;
      } catch {
        record.ready = false;
      }
      try {
        await transition.finished;
      } catch {
        record.ready = false;
      }
      record.finished = true;
    }
    const original: unknown = Reflect.get(
      Document.prototype,
      "startViewTransition",
    );
    if (typeof original !== "function") {
      throw new TypeError("This browser has no view transitions");
    }
    Reflect.set(
      Document.prototype,
      "startViewTransition",
      function startViewTransition(this: Document, ...args: unknown[]) {
        const record: Recorded = {
          carriers: carriersNow(),
          ready: null,
          finished: false,
          poster: false,
          after: 0,
          landedOn: null,
        };
        log.push(record);
        const transition: unknown = Reflect.apply(original, this, args);
        if (transition instanceof ViewTransition)
          void follow(transition, record);
        return transition;
      },
    );
  });
}

async function recorded(page: Page): Promise<Recorded[]> {
  return page.evaluate(() => globalThis.viewTransitionLog ?? []);
}

/** The `index`th transition once the page has finished it. */
async function finished(page: Page, index: number): Promise<Recorded> {
  await expect
    .poll(async () => {
      const log = await recorded(page);
      return log[index]?.finished;
    })
    .toBe(true);
  const log = await recorded(page);
  const found = log[index];
  if (found === undefined) throw new Error(`Transition ${String(index)} lost`);
  return found;
}

/** How many elements carry the transition's name right now. */
async function carriers(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...globalThis.document.querySelectorAll("*")].filter((element) =>
        globalThis
          .getComputedStyle(element)
          .viewTransitionName.endsWith("title-poster"),
      ).length,
  );
}

const dune = FEATURED.movie;
const library = (page: Page) =>
  page.getByRole("list", { name: "Library titles" });
const cardFor = (page: Page, title: string) =>
  library(page).getByRole("link", { name: new RegExp(title, "u") });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** Opens the film from its card, then returns with the page's own Back. */
async function openAndGoBack(page: Page) {
  await cardFor(page, dune.title).click();
  await expect(heading(page)).toHaveText(dune.title);
  await settle(page);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(heading(page)).toHaveText("Library");
}

test.describe("with view transitions", () => {
  test("a card's poster moves to the title page and back on Back", async ({
    page,
  }) => {
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    await expect(library(page).getByRole("listitem")).toHaveCount(48);
    // Nothing carries the name at rest: not one of 48 cards.
    expect(await carriers(page)).toBe(0);

    await cardFor(page, dune.title).click();
    await expect(heading(page)).toHaveText(dune.title);
    // One poster carried the name, the browser took the pair, and it ran.
    expect(await finished(page, 0)).toMatchObject({
      carriers: 1,
      ready: true,
      poster: true,
    });
    expect(await carriers(page)).toBe(0);

    await settle(page);
    // The page's own Back moves the poster home again.
    await page.getByRole("link", { name: "Back" }).click();
    await expect(heading(page)).toHaveText("Library");
    expect(address(page)).toBe("/library");
    expect(await finished(page, 1)).toMatchObject({
      carriers: 1,
      ready: true,
      poster: true,
    });
    expect(await carriers(page)).toBe(0);
  });

  test("the browser's Back button moves it too", async ({ page }) => {
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    await cardFor(page, dune.title).click();
    await expect(heading(page)).toHaveText(dune.title);
    await settle(page);
    await page.goBack();
    await expect(heading(page)).toHaveText("Library");
    expect(await finished(page, 1)).toMatchObject({
      carriers: 1,
      ready: true,
      poster: true,
    });
  });

  test("going back through several title visits lands each poster on its own card", async ({
    page,
  }) => {
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    // Library to A, then Discover to B: the second visit must not make the
    // router forget which Library card opened the first.
    await cardFor(page, dune.title).click();
    await expect(heading(page)).toHaveText(dune.title);
    await settle(page);
    await page.getByRole("link", { name: "Discover" }).first().click();
    await expect(heading(page)).toHaveText("Discover");
    await settle(page);
    const discoverCard = page.locator("main article a").first();
    const discoverTitle = await discoverCard.locator("h2, h3").innerText();
    await discoverCard.click();
    await expect(heading(page)).toHaveText(discoverTitle);
    await settle(page);
    const toSecond = await finished(page, 1);
    expect(toSecond.carriers).toBe(1);

    // Back to Discover: the card that was opened there.
    await page.goBack();
    await expect(heading(page)).toHaveText("Discover");
    const toDiscover = await finished(page, 2);
    expect(toDiscover).toMatchObject({ ready: true, poster: true, after: 1 });
    expect(toDiscover.landedOn).toContain(discoverTitle);
    await settle(page);

    // Back to the first title: Discover and that title were never moved
    // between, so the router runs no transition. Then to the Library card
    // that opened it, though B was the last card opened anywhere.
    await page.goBack();
    await expect(heading(page)).toHaveText(dune.title);
    await settle(page);
    await page.goBack();
    await expect(heading(page)).toHaveText("Library");
    const toLibrary = await finished(page, 3);
    expect(toLibrary).toMatchObject({ ready: true, poster: true, after: 1 });
    expect(toLibrary.landedOn).toContain(dune.title);
    expect(await recorded(page)).toHaveLength(4);
    expect(await carriers(page)).toBe(0);
  });

  test("only the card that was opened carries the name", async ({ page }) => {
    await watchTransitions(page);
    // Several episodes of one series in a week, each a row to the same
    // title page.
    await openSettled(page, "member", "/calendar?view=agenda");
    const rows = page.getByRole("link", { name: /Severance/u });
    expect(await rows.count()).toBeGreaterThan(1);
    await rows.nth(1).click();
    expect(await finished(page, 0)).toMatchObject({
      carriers: 1,
      ready: true,
    });
  });

  test("a switch between tabs is not a transition", async ({ page }) => {
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    await page.getByRole("link", { name: "Calendar" }).first().click();
    await expect(heading(page)).toHaveText("Calendar");
    await page.goBack();
    await expect(heading(page)).toHaveText("Library");
    expect(await recorded(page)).toEqual([]);
  });

  test("a title that is not there opens its page without holding the old one", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("The project has no baseURL");
    const failures = watchForFailures(page, baseURL);
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    await page.route(
      new RegExp(`/api/v1/media/${dune.id}(/|$)`, "u"),
      async (route) =>
        route.fulfill({
          status: 404,
          json: { error: { code: "not_found", message: "Gone" } },
        }),
    );
    await cardFor(page, dune.title).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "This title is not here" }),
    ).toBeVisible();
    await finished(page, 0);
    expect(await carriers(page)).toBe(0);
    // The browser reports the 404 itself; nothing else may go wrong.
    expect(
      failures.filter(
        (line) =>
          !line.startsWith("HTTP 404") &&
          !line.includes("status of 404 (Not Found)"),
      ),
    ).toEqual([]);
  });
});

test.describe("when the reader wants less motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a card opens its title with no transition at all", async ({ page }) => {
    await watchTransitions(page);
    await openSettled(page, "member", "/library");
    await openAndGoBack(page);
    expect(await recorded(page)).toEqual([]);
  });
});

test.describe("in a browser without view transitions", () => {
  test("a card still opens its title, and Back still returns", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("The project has no baseURL");
    const failures = watchForFailures(page, baseURL);
    await page.addInitScript(() => {
      Reflect.deleteProperty(Document.prototype, "startViewTransition");
    });
    await openAs(page, "member", "/library");
    await settle(page);
    expect(
      await page.evaluate(() => "startViewTransition" in globalThis.document),
    ).toBe(false);
    await openAndGoBack(page);
    expect(address(page)).toBe("/library");
    expect(await carriers(page)).toBe(0);
    expect(failures).toEqual([]);
  });
});
