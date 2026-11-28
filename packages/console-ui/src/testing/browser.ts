/**
 * Shared helpers for Vitest browser-mode tests (`*.browser.test.tsx`). Import
 * from `@shepherdjerred/console-ui/testing/browser.ts` in any console package
 * that opts into `../../vitest.browser.config.ts`.
 */
import axe from "axe-core";
import { page } from "vitest/browser";
import { expect } from "vitest";

/** The WCAG 2.2 AA rule tags the Playwright axe suites already enforce. */
export const WCAG_TAGS: readonly string[] = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export type Viewport = { readonly width: number; readonly height: number };

/** The two widths every console surface is checked at. */
export const VIEWPORTS = {
  mobile: { width: 375, height: 800 },
  desktop: { width: 1280, height: 800 },
} as const satisfies Record<string, Viewport>;

/** One entry per violation: rule, impact, help text, and the failing nodes. */
export function formatViolations(violations: readonly axe.Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    ${node.target.join(" ")}\n      ${node.html}`)
        .join("\n");
      return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${nodes}`;
    })
    .join("\n");
}

/** Runs axe with the WCAG 2.2 AA tag set and returns the violations. */
export async function axeViolations(
  context: Element = document.body,
): Promise<axe.Result[]> {
  const results = await axe.run(context, {
    runOnly: { type: "tag", values: [...WCAG_TAGS] },
  });
  return results.violations;
}

/** Fails with a readable list when the rendered page breaks a WCAG 2.2 AA rule. */
export async function expectNoAxeViolations(
  context: Element = document.body,
): Promise<void> {
  const violations = await axeViolations(context);
  expect(violations, formatViolations(violations)).toEqual([]);
}

/** Pins the theme the way the apps do: `data-theme` on the root element. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}

/** Resizes the test iframe; layout is then computed at that width. */
export async function setViewport(
  viewport: Viewport = VIEWPORTS.desktop,
): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
}

/** Fails when the page scrolls horizontally. */
export function expectNoHorizontalOverflow(): void {
  const root = document.documentElement;
  expect(root.scrollWidth, "document scrollWidth").toBeLessThanOrEqual(
    root.clientWidth,
  );
}
