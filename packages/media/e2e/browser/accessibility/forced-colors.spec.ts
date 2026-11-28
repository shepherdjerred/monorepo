import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "#e2e/browser/support.ts";
import type { RouteCase } from "#e2e/browser/routes.ts";

/**
 * Forced colors (Windows high contrast): the browser replaces every color the
 * page chose, so a mark that is only a fill or a shadow disappears. Each of
 * these is a state the page shows by fill alone in its own colors; here it
 * must still differ from its neighbours.
 */
test.use({ forcedColors: "active" });

const page = (persona: RouteCase["persona"], path: string): RouteCase => ({
  label: `${persona} ${path}`,
  persona,
  path,
  heading: "",
  title: "",
});

async function openAt(
  browserPage: Page,
  baseURL: string | undefined,
  route: RouteCase,
) {
  if (baseURL === undefined) throw new Error("The project has no baseURL");
  await browserPage.context().addCookies([
    {
      name: "media-fixture-persona",
      value: route.persona,
      url: baseURL,
    },
  ]);
  await browserPage.goto(route.path);
  await expect(browserPage.getByRole("heading", { level: 1 })).toBeVisible();
  await browserPage.waitForLoadState("networkidle");
}

test("the forced-colors emulation is on", async ({ page: browserPage }) => {
  await browserPage.goto("/");
  expect(
    await browserPage.evaluate(
      () => globalThis.matchMedia("(forced-colors: active)").matches,
    ),
  ).toBe(true);
});

test("the current Library view differs from the others", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("member", "/library"));
  const views = browserPage.getByRole("navigation", { name: "Library views" });
  const current = views.locator("[aria-current]");
  const other = views.locator("a:not([aria-current])").first();
  const colors = async (link: typeof current) =>
    link.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return `${style.backgroundColor} ${style.color}`;
    });
  expect(await colors(current)).not.toBe(await colors(other));
});

test("the current page in the sidebar differs from the others", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("member", "/calendar"));
  const nav = browserPage.getByRole("navigation", { name: "Main" });
  const colors = async (link: ReturnType<typeof nav.locator>) =>
    link.first().evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return `${style.backgroundColor} ${style.color}`;
    });
  expect(await colors(nav.locator("[aria-current]"))).not.toBe(
    await colors(nav.locator("a:not([aria-current])")),
  );
});

test("a status badge keeps its outline", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("owner", "/manage/activity"));
  const badge = browserPage
    .locator('[class*="_status"][data-tone]')
    .filter({ hasText: /^Completed$/u })
    .first();
  expect(
    await badge.evaluate((element) =>
      Number.parseFloat(globalThis.getComputedStyle(element).borderTopWidth),
    ),
  ).toBeGreaterThan(0);
});

test("a progress bar is drawn", async ({ page: browserPage, baseURL }) => {
  await openAt(browserPage, baseURL, page("member", "/"));
  const meter = browserPage.locator("progress").first();
  await expect(meter).toBeVisible();
  // Its own track and fill are fills, which forced colors remove; the edge
  // is what is left of the bar.
  expect(
    await meter.evaluate((element) =>
      Number.parseFloat(globalThis.getComputedStyle(element).borderTopWidth),
    ),
  ).toBeGreaterThan(0);
});

test("today is marked on the month grid", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("member", "/calendar?view=month"));
  const fills = await browserPage
    .locator('[class*="cellNumeral"]')
    .evaluateAll((numerals) =>
      numerals.map(
        (element) => globalThis.getComputedStyle(element).backgroundColor,
      ),
    );
  // Today's numeral is the only one with a fill of its own.
  expect(new Set(fills).size).toBeGreaterThan(1);
});

test("a checked box differs from an unchecked one", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("owner", "/manage/subtitles"));
  const box = browserPage.getByRole("checkbox").first();
  const fill = async () =>
    box.evaluate(
      (element) => globalThis.getComputedStyle(element).backgroundColor,
    );
  await box.uncheck();
  const unchecked = await fill();
  await box.check();
  expect(await fill()).not.toBe(unchecked);
});

async function expectActiveEdgeDiffersFromResting(
  active: Locator,
  resting: Locator,
) {
  const readEdge = async (control: Locator) =>
    control.evaluate((element) => {
      const style = globalThis.getComputedStyle(element);
      return {
        borderTopColor: style.borderTopColor,
        outlineStyle: style.outlineStyle,
      };
    });
  const [activeEdge, restingEdge] = await Promise.all([
    readEdge(active),
    readEdge(resting),
  ]);
  expect(activeEdge.outlineStyle).toBe("solid");
  expect(restingEdge.outlineStyle).toBe("none");
  expect(activeEdge.borderTopColor).not.toBe(restingEdge.borderTopColor);
}

test("an active filter choice differs from a resting one", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(browserPage, baseURL, page("member", "/library?kind=movie"));
  await expectActiveEdgeDiffersFromResting(
    browserPage.getByLabel("Films or series"),
    browserPage.getByLabel("How long it is kept"),
  );
});

test("an active date filter differs from an empty one", async ({
  page: browserPage,
  baseURL,
}) => {
  await openAt(
    browserPage,
    baseURL,
    page("member", "/history?from=2026-03-01T00:00:00.000Z"),
  );
  await expectActiveEdgeDiffersFromResting(
    browserPage.locator('label:has(input[aria-label="From this day"])'),
    browserPage.locator('label:has(input[aria-label="Before this day"])'),
  );
});
