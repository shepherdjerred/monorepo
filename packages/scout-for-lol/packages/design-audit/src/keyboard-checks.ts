import { expect, type Page } from "@playwright/test";
import { evaluateBrowser } from "#src/page-checks.ts";

const baseFocusSelector =
  ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';

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
  const focusBaselines = await evaluateBrowser(page, () => {
    const baseSelector =
      ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';
    const selector =
      window.innerWidth < 800
        ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
        : baseSelector;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => element.checkVisibility())
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });
  });
  const count = await evaluateBrowser(page, () => {
    const baseSelector =
      ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';
    const selector =
      window.innerWidth < 800
        ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
        : baseSelector;
    return [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (element) => element.checkVisibility(),
    ).length;
  });
  const checks = count;
  const visited = new Set<number>();
  let skipNextTab = false;
  for (
    let attempts = 0;
    visited.size < checks && attempts < checks * 10;
    attempts += 1
  ) {
    if (!skipNextTab) {
      await page.keyboard.press("Tab");
    }
    skipNextTab = false;
    const focusState = await evaluateBrowser(page, () => {
      // MUST stay identical to the selector used for `focusBaselines` and
      // `count` above. It had drifted — this copy omitted `[tabindex]` — so an
      // element focusable only via `tabindex="0"` was counted in `checks` but
      // could never appear in `expectedControls`. Its `expectedIndex` came back
      // -1, the stop was skipped forever, and `visited.size` could never reach
      // `checks`: "keyboard focus did not reach every visible control" on any
      // page containing one (27 of 58 routes). The mismatch also misaligned
      // `focusBaselines[expectedIndex]`, comparing each control's focus ring
      // against a different element's baseline.
      const baseSelector =
        ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';
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
      ].filter((candidate) => candidate.checkVisibility());
      const expectedIndex = expectedControls.indexOf(element);
      if (expectedIndex === -1) return { kind: "skip" as const };
      const style = getComputedStyle(element);
      return {
        kind: "control" as const,
        expectedIndex,
        isMonaco: element.closest(".monaco-editor") !== null,
        description: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
        focusStyle: {
          outlineColor: style.outlineColor,
          outlineOffset: style.outlineOffset,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        },
      };
    });
    if (focusState.kind === "skip") continue;
    if (focusState.expectedIndex >= checks) continue;
    if (visited.has(focusState.expectedIndex)) continue;
    const baseline = focusBaselines[focusState.expectedIndex];
    const hasIndicator =
      baseline !== undefined &&
      ((focusState.focusStyle.outlineStyle !== "none" &&
        Number.parseFloat(focusState.focusStyle.outlineWidth) > 0 &&
        (focusState.focusStyle.outlineColor !== baseline.outlineColor ||
          focusState.focusStyle.outlineOffset !== baseline.outlineOffset ||
          focusState.focusStyle.outlineStyle !== baseline.outlineStyle ||
          focusState.focusStyle.outlineWidth !== baseline.outlineWidth)) ||
        (focusState.focusStyle.boxShadow !== "none" &&
          focusState.focusStyle.boxShadow !== baseline.boxShadow));
    expect(
      hasIndicator,
      `focus stop ${String(visited.size + 1)} (${focusState.description}) must have a visible outline or focus ring`,
    ).toBe(true);
    visited.add(focusState.expectedIndex);
    if (focusState.isMonaco) {
      const bypassedMonaco = await evaluateBrowser(page, () => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return false;
        const editor = active.closest(".monaco-editor");
        if (editor === null) return false;
        const baseSelector =
          ':is(a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [tabindex]):not([tabindex="-1"]):not(:disabled):not([aria-disabled="true"]):not(astro-dev-toolbar):not(.iPadShowKeyboard):not([aria-hidden="true"] *):not([inert] *)';
        const selector =
          window.innerWidth < 800
            ? `${baseSelector}:not(.sidebar-pane):not(.sidebar-pane *):not(.right-sidebar):not(.right-sidebar *)`
            : baseSelector;
        const expectedControls = [
          ...document.querySelectorAll<HTMLElement>(selector),
        ].filter((candidate) => candidate.checkVisibility());
        const expectedIndex = expectedControls.indexOf(active);
        for (const control of editor.querySelectorAll<HTMLElement>(
          "textarea, input, [tabindex]",
        )) {
          if (control.tabIndex < 0) continue;
          control.dataset["designAuditPreviousTabIndex"] =
            control.getAttribute("tabindex") ?? "";
          control.tabIndex = -1;
        }
        const previous = expectedControls[expectedIndex - 1];
        if (previous instanceof HTMLElement) {
          previous.focus();
        } else {
          active.blur();
          document.body.focus();
        }
        return true;
      });
      if (bypassedMonaco) {
        await page.keyboard.press("Tab");
        await evaluateBrowser(page, () => {
          for (const control of document.querySelectorAll<HTMLElement>(
            "[data-design-audit-previous-tab-index]",
          )) {
            const previous = control.dataset["designAuditPreviousTabIndex"];
            if (previous === "") {
              control.removeAttribute("tabindex");
            } else if (previous !== undefined) {
              control.setAttribute("tabindex", previous);
            }
            delete control.dataset["designAuditPreviousTabIndex"];
          }
        });
        // Keep the real Tab stop active so the next iteration checks its
        // keyboard-modality focus indicator before moving on.
        skipNextTab = true;
      }
    }
  }
  if (visited.size < checks) {
    throw new Error("keyboard focus did not reach every visible control");
  }
}
