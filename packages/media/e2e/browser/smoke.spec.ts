import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { KNOWN_VIOLATIONS } from "./axe-baseline.ts";
import { ROUTES, type RouteCase } from "./routes.ts";
import {
  accessibilityViolations,
  canvasColor,
  computedForm,
  open,
  test,
  watchForFailures,
} from "./support.ts";

const SCHEMES = ["light", "dark"] as const;
const DIST_ASSETS = path.resolve(import.meta.dir, "../../dist/assets");

function knownRules(route: RouteCase): string[] {
  return KNOWN_VIOLATIONS.filter((known) => known.routes.includes(route.label))
    .map((known) => known.rule)
    .sort((left, right) => left.localeCompare(right));
}

/** Pins a theme the way the account menu will: `data-theme` on the root. */
async function pinTheme(page: Page, theme: (typeof SCHEMES)[number]) {
  await page.locator("html").evaluate((root, pinned) => {
    root.dataset["theme"] = pinned;
  }, theme);
}

test("the axe baseline names only routes this suite visits", () => {
  const labels = ROUTES.map((route) => route.label);
  expect(new Set(labels).size).toBe(labels.length);
  for (const known of KNOWN_VIOLATIONS) {
    expect(new Set(known.routes).size, known.rule).toBe(known.routes.length);
    expect(
      known.routes.filter((label) => !labels.includes(label)),
      known.rule,
    ).toEqual([]);
  }
});

test("the built stylesheet is self-contained and down-leveled", async () => {
  const files = await readdir(DIST_ASSETS);
  const sheets = files.filter((file) => file.endsWith(".css"));
  expect(sheets).not.toEqual([]);
  for (const sheet of sheets) {
    const css = await Bun.file(path.join(DIST_ASSETS, sheet)).text();
    // light-dark() is newer than the browsers the build targets; the tokens
    // rely on the build rewriting every use of it.
    expect(css, sheet).not.toContain("light-dark(");
    expect(css, sheet).not.toMatch(/https?:\/\//u);
    // The browser fixes the layer order at the first `@layer` it reads.
    expect(/@layer ([a-z]+)/u.exec(css)?.[1], sheet).toBe("reset");
  }
});

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("follows the system scheme until a theme is pinned", async ({
      page,
    }) => {
      await page.goto("/");
      // The canvas is the color this scheme's theme-color meta announces.
      const themeColor = await page
        .locator(
          `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
        )
        .getAttribute("content");
      if (themeColor === null) throw new Error("No theme-color content");
      const announced = computedForm(themeColor);
      expect(await canvasColor(page)).toBe(announced);

      // A pinned theme wins over the system's, in either direction.
      await pinTheme(page, scheme === "light" ? "dark" : "light");
      expect(await canvasColor(page)).not.toBe(announced);
      await pinTheme(page, scheme);
      expect(await canvasColor(page)).toBe(announced);
    });

    for (const route of ROUTES) {
      test(`${route.label} renders its fixtures`, async ({ page, baseURL }) => {
        if (baseURL === undefined) {
          throw new Error("The Playwright project has no baseURL");
        }
        const failures = watchForFailures(page, new URL(baseURL).origin);
        await open(page, route, baseURL);

        // The shared error notice, the error state, and the Manage pages'
        // error callout, by their own marks: `role="alert"` alone also
        // matches product copy such as a bounced-email warning on a
        // notification.
        await expect(
          page.locator(
            '.notice-error, [data-ui="error-state"], [role="alert"][data-tone="danger"]',
          ),
        ).toHaveCount(0);
        expect(failures).toEqual([]);
        await expect(page).toHaveTitle(route.title);

        const violations = await accessibilityViolations(page);
        const found = violations
          .map((violation) => violation.rule)
          .sort((left, right) => left.localeCompare(right));
        // On a mismatch, the selectors say where to look.
        const detail = violations
          .map((violation) => violation.detail)
          .join("\n");
        expect(found, detail).toEqual(knownRules(route));
      });
    }
  });
}
