import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

/**
 * Shared harness for walking a built Storybook catalog from Playwright.
 *
 * Both Scout catalogs — this package's and the app's — assert the same baseline
 * about every story, so the pieces that do not vary live here rather than being
 * copied into each package's `e2e/`.
 */

const StorybookEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  type: z.string(),
});

const StorybookIndexSchema = z.object({
  v: z.number(),
  entries: z.record(z.string(), StorybookEntrySchema),
});

export type StorybookEntry = z.infer<typeof StorybookEntrySchema>;

/**
 * Reads the story index from a built catalog.
 *
 * Playwright collects spec files before it starts the web server, so the index
 * has to come off disk rather than over HTTP. Pass the URL of the catalog's
 * `index.json`, usually
 * `new URL("../storybook-static/index.json", import.meta.url)`.
 */
export async function loadStorybookStories(
  indexUrl: URL | string,
): Promise<StorybookEntry[]> {
  const index = StorybookIndexSchema.parse(await Bun.file(indexUrl).json());
  return Object.values(index.entries).filter((entry) => entry.type === "story");
}

/**
 * Axe rules that judge the document a fragment was lifted out of.
 *
 * A story renders one component, so these fail on every story for reasons no
 * component owns — including heading-order, which a panel starting at `<h3>`
 * cannot satisfy without the page that precedes it.
 */
export const STORY_PAGE_LEVEL_AXE_RULES = [
  "region",
  "landmark-one-main",
  "page-has-heading-one",
  "bypass",
  "heading-order",
];

/** The iframe URL that renders one story at a chosen skin and mode. */
export function storyUrl(options: {
  id: string;
  skin?: string;
  mode?: string;
}): string {
  const globals = [
    options.skin === undefined ? [] : [`skin:${options.skin}`],
    options.mode === undefined ? [] : [`mode:${options.mode}`],
  ].flat();
  const suffix = globals.length === 0 ? "" : `&globals=${globals.join(";")}`;
  return `/iframe.html?viewMode=story&id=${options.id}${suffix}`;
}

/**
 * Opens one story and asserts the baseline every Scout story must meet: the
 * requested theme actually applied, something mounted, and Storybook did not
 * swap in its error screen.
 *
 * Returns the page errors collected since navigation, so a caller can assert on
 * them after any further interaction of its own.
 */
export async function mountStory(
  page: Page,
  story: { id: string; skin: string; mode: string },
): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  // Seed the stored preference before the document loads, so the pre-paint
  // bootstrap resolves the requested theme itself. Without this the page starts
  // on the default preference and only reaches the requested theme once React
  // commits — which a story that suspends or renders nothing never does, and
  // the theme assertion then fails for a reason unrelated to the component.
  await page.addInitScript(
    ([skin, mode]) => {
      localStorage.setItem(
        "scout-theme-v1",
        JSON.stringify({ version: 1, skin, mode }),
      );
    },
    [story.skin, story.mode],
  );

  await page.goto(storyUrl(story));

  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    story.skin,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    story.mode,
  );
  // Mounted, not non-blank: icon-only stories render no text at all.
  await expect(page.locator("#storybook-root > *").first()).toBeAttached();
  await expect(page.locator("body.sb-show-errordisplay")).toHaveCount(0);
  return pageErrors;
}

/** Runs axe over the mounted story, ignoring rules a fragment cannot satisfy. */
export async function expectStoryAccessible(page: Page): Promise<void> {
  const accessibility = await new AxeBuilder({ page })
    .disableRules(STORY_PAGE_LEVEL_AXE_RULES)
    .analyze();
  expect(accessibility.violations).toEqual([]);
}

/**
 * The JUnit reporter the browser-E2E lane expects, alongside GitHub annotations.
 *
 * `run-playwright.ts` asserts a non-empty report at
 * `.ci-reports/junit/<reportDirectory>/playwright.xml` for every target whose
 * Turbo cache missed, so the path is a contract rather than a preference.
 */
export function storybookCiReporter(
  reportDirectory: string,
): [string, Record<string, string>][] {
  return [
    ["github", {}],
    [
      "junit",
      {
        outputFile: `../../../../.ci-reports/junit/${reportDirectory}/playwright.xml`,
      },
    ],
  ];
}
