import { expect, type Page } from "@playwright/test";
import { evaluateBrowser } from "#src/page-checks.ts";

const baseFocusSelector =
  ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';

export async function assertKeyboardFocus(
  page: Page,
  tabKey: "Tab" | "Alt+Tab",
): Promise<void> {
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
  // Establish keyboard modality before programmatic focus so :focus-visible
  // behaves like real Tab navigation in Chromium and Safari.
  await page.keyboard.press(tabKey);
  const result = await evaluateBrowser(page, async () => {
    const baseSelector =
      ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';
    const selector =
      window.innerWidth < 800
        ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
        : baseSelector;
    const controls = [
      ...document.querySelectorAll<HTMLElement>(selector),
    ].filter((element) => element.checkVisibility());
    const failures: string[] = [];
    let audited = 0;

    for (const element of controls) {
      if (!element.isConnected || !element.checkVisibility()) continue;
      element.focus({ preventScroll: true });
      await new Promise<void>((resolve) => {
        globalThis.requestAnimationFrame(() => {
          resolve();
        });
      });
      const description = element.outerHTML.slice(0, 500);
      if (document.activeElement !== element) {
        failures.push(`${description} did not accept keyboard focus`);
        continue;
      }
      const focusElement =
        element.closest("[data-focus-ring-container]") ?? element;
      const focusStyleDeclaration = getComputedStyle(focusElement);
      const focusStyle = {
        outlineColor: focusStyleDeclaration.outlineColor,
        outlineOffset: focusStyleDeclaration.outlineOffset,
        outlineStyle: focusStyleDeclaration.outlineStyle,
        outlineWidth: focusStyleDeclaration.outlineWidth,
        boxShadow: focusStyleDeclaration.boxShadow,
      };
      element.blur();
      const baselineStyle = getComputedStyle(focusElement);
      const hasIndicator =
        (focusStyle.outlineStyle !== "none" &&
          Number.parseFloat(focusStyle.outlineWidth) > 0 &&
          (focusStyle.outlineColor !== baselineStyle.outlineColor ||
            focusStyle.outlineOffset !== baselineStyle.outlineOffset ||
            focusStyle.outlineStyle !== baselineStyle.outlineStyle ||
            focusStyle.outlineWidth !== baselineStyle.outlineWidth)) ||
        (focusStyle.boxShadow !== "none" &&
          focusStyle.boxShadow !== baselineStyle.boxShadow);
      if (!hasIndicator) {
        failures.push(`${description} has no visible focus indicator`);
      }
      audited += 1;
    }
    return { audited, failures };
  });
  expect(
    result.audited,
    "pages must expose keyboard-focusable controls",
  ).toBeGreaterThan(0);
  expect(result.failures, "keyboard focus failures").toEqual([]);
}
