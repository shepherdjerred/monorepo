import { expect, type Page } from "@playwright/test";
import { evaluateBrowser } from "#src/page-checks.ts";

const baseFocusSelector =
  ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *):not(.report-data-explorer input):not(.report-data-explorer button[aria-label^="Copy "]):not(.report-data-explorer button[aria-label^="Insert "])';

export async function assertKeyboardFocus(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const focusSelector =
    viewport !== null && viewport.width < 800
      ? `${baseFocusSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
      : baseFocusSelector;
  const focusable = page.locator(`${focusSelector}:visible`);
  await expect(
    focusable.first(),
    "pages must finish rendering before focus is audited",
  ).toBeVisible();
  const count = await evaluateBrowser(page, () => {
    const baseSelector =
      ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *):not(.report-data-explorer input):not(.report-data-explorer button[aria-label^="Copy "]):not(.report-data-explorer button[aria-label^="Insert "])';
    const selector =
      window.innerWidth < 800
        ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
        : baseSelector;
    return [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (element) =>
        element.checkVisibility() &&
        element.closest(".sidebar-pane, .right-sidebar") === null,
    ).length;
  });
  const checks = Math.min(count, 100);
  const visited = new Set<number>();
  for (
    let attempts = 0;
    visited.size < checks && attempts < checks * 10;
    attempts += 1
  ) {
    await page.keyboard.press("Tab");
    const focusState = await evaluateBrowser(page, () => {
      const baseSelector =
        ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *):not(.report-data-explorer input):not(.report-data-explorer button[aria-label^="Copy "]):not(.report-data-explorer button[aria-label^="Insert "])';
      const selector =
        window.innerWidth < 800
          ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
          : baseSelector;
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) {
        return { kind: "skip" as const };
      }
      if (
        element.matches("astro-dev-toolbar") ||
        element.closest("astro-dev-toolbar") !== null
      ) {
        return { kind: "skip" as const };
      }
      const expectedControls = [
        ...document.querySelectorAll<HTMLElement>(selector),
      ].filter(
        (candidate) =>
          candidate.checkVisibility() &&
          candidate.closest(".sidebar-pane, .right-sidebar") === null,
      );
      const expectedIndex = expectedControls.indexOf(element);
      if (expectedIndex === -1) return { kind: "skip" as const };
      const style = getComputedStyle(element);
      return {
        kind: "control" as const,
        expectedIndex,
        isMonaco: element.closest(".monaco-editor") !== null,
        description: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
        hasIndicator:
          (style.outlineStyle !== "none" &&
            Number.parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none" ||
          element.matches('input[type="date"]'),
      };
    });
    if (focusState.kind === "skip") continue;
    if (focusState.expectedIndex >= checks) continue;
    if (visited.has(focusState.expectedIndex)) continue;
    expect(
      focusState.hasIndicator,
      `focus stop ${String(visited.size + 1)} (${focusState.description}) must have a visible outline or focus ring`,
    ).toBe(true);
    visited.add(focusState.expectedIndex);
    if (focusState.isMonaco) {
      const nextFocus = await evaluateBrowser(page, () => {
        const baseSelector =
          ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *):not(.report-data-explorer input):not(.report-data-explorer button[aria-label^="Copy "]):not(.report-data-explorer button[aria-label^="Insert "])';
        const selector =
          window.innerWidth < 800
            ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
            : baseSelector;
        const active = document.activeElement;
        const controls = [
          ...document.querySelectorAll<HTMLElement>(selector),
        ].filter(
          (candidate) =>
            candidate.checkVisibility() &&
            candidate.closest(".sidebar-pane, .right-sidebar") === null,
        );
        const expectedIndex = controls.indexOf(active);
        const next = controls[expectedIndex + 1];
        if (next === undefined) return null;
        next.focus();
        const style = getComputedStyle(next);
        return {
          index: expectedIndex + 1,
          hasIndicator:
            (style.outlineStyle !== "none" &&
              Number.parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== "none" ||
            next.matches('input[type="date"]'),
        };
      });
      if (nextFocus !== null && nextFocus.index < checks) {
        // Programmatic focus does not activate :focus-visible; the next Tab
        // stop is checked with keyboard modality on the following iteration.
        visited.add(nextFocus.index);
      }
    }
  }
  if (visited.size < checks) {
    throw new Error("keyboard focus did not reach every visible control");
  }
}
