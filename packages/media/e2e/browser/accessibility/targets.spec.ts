import { expect } from "@playwright/test";
import { ROUTES } from "#e2e/browser/routes.ts";
import { open, test } from "#e2e/browser/support.ts";

test.describe.configure({ mode: "parallel" });

type Box = { width: number; height: number };

/** What the page says about one control; the exemptions are judged here. */
type Control = {
  name: string;
  box: Box;
  /** Not drawn at all, or above the page where a skip link waits. */
  offscreen: boolean;
  /** A link inside a line of text. */
  inline: boolean;
  /** A checkbox or radio: the boxes of its labels, the same control. */
  labels: Box[] | null;
};

const CONTROLS =
  "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [tabindex='0']";

const bigEnough = ({ width, height }: Box) => width >= 24 && height >= 24;

function tooSmall(control: Control): boolean {
  const exempt =
    control.offscreen ||
    control.inline ||
    bigEnough(control.box) ||
    control.labels?.some((label) => bigEnough(label)) === true;
  return !exempt;
}

/**
 * WCAG 2.2 target size (2.5.8): every control is at least 24 by 24 CSS pixels.
 * Exempt are a link inside a line of text, and a drawn checkbox or radio whose
 * label, the same control, is that big. axe does not measure this.
 */
for (const route of ROUTES) {
  test(`${route.label} has no control smaller than 24 by 24`, async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("The project has no baseURL");
    await open(page, route, baseURL);
    const controls = await page.locator(CONTROLS).evaluateAll((elements) =>
      elements.map((element): Control => {
        const box = element.getBoundingClientRect();
        const style = globalThis.getComputedStyle(element);
        const hidden =
          element.closest(".sr-only, [hidden], [inert]") !== null ||
          style.visibility === "hidden" ||
          style.display === "none";
        const checkable =
          element instanceof globalThis.HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type);
        return {
          name: `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 40)}"`,
          box: { width: box.width, height: box.height },
          offscreen: hidden || box.width === 0 || box.bottom <= 0,
          inline:
            element instanceof globalThis.HTMLAnchorElement &&
            style.display === "inline",
          labels: checkable
            ? Array.from(element.labels ?? [], (label) => {
                const labelBox = label.getBoundingClientRect();
                return { width: labelBox.width, height: labelBox.height };
              })
            : null,
        };
      }),
    );
    expect(
      controls
        .filter((control) => tooSmall(control))
        .map(
          (control) =>
            `${control.name} ${String(Math.round(control.box.width))}x${String(Math.round(control.box.height))}`,
        ),
    ).toEqual([]);
  });
}
