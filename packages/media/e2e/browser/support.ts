import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { PERSONA_COOKIE } from "#testing/fixture-api/server.ts";

/** Opens `path` as a persona and waits for the shell to hold a page. */
export async function openAs(page: Page, persona: Persona, path: string) {
  const base = test.info().project.use.baseURL;
  if (base === undefined) {
    throw new Error("The Playwright project has no baseURL");
  }
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: persona, url: base }]);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** The computed background of the page canvas, as the browser serializes it. */
export async function canvasColor(page: Page): Promise<string> {
  return page
    .locator("html")
    .evaluate((root) => globalThis.getComputedStyle(root).backgroundColor);
}

/** `#rrggbb` as the `rgb(r, g, b)` string a computed style reports. */
export function computedForm(hex: string): string {
  const channels = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(hex);
  if (channels === null) throw new Error(`Not a six-digit hex color: ${hex}`);
  return `rgb(${channels
    .slice(1)
    .map((channel) => String(Number.parseInt(channel, 16)))
    .join(", ")})`;
}

/**
 * The WCAG 2.2 AA violations on the page as it stands: each rule that failed
 * and, as `rule: selectors`, where to look.
 */
export async function accessibilityViolations(
  page: Page,
): Promise<{ rule: string; detail: string }[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    detail: `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
  }));
}

/** Those violations as `rule: selectors`; empty when the page is clean. */
export async function violationDetails(page: Page): Promise<string[]> {
  const found = await accessibilityViolations(page);
  return found.map((violation) => violation.detail);
}
