import { expect } from "@playwright/test";
import { ROUTES } from "#e2e/browser/routes.ts";
import { open, test } from "#e2e/browser/support.ts";

test.describe.configure({ mode: "parallel" });

/**
 * WCAG 1.4.12 text spacing: with the reader's own line height, letter, word
 * and paragraph spacing applied, no box cuts its text off. The override is a
 * style the page's strict Content-Security-Policy would refuse, so these
 * pages open with the policy off; every other spec runs with it on.
 */
test.use({ bypassCSP: true });

const SPACING = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`;

for (const route of ROUTES) {
  test(`${route.label} keeps its text with the reader's spacing`, async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("The project has no baseURL");
    await open(page, route, baseURL);
    await page.addStyleTag({ content: SPACING });
    const clipped = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of globalThis.document.querySelectorAll("main *")) {
        if (element.closest(".sr-only") !== null) continue;
        const style = globalThis.getComputedStyle(element);
        const hidesY = ["hidden", "clip"].includes(style.overflowY);
        // A line clamp or an ellipsis is a stated truncation, not a loss.
        const truncates =
          style.webkitLineClamp !== "none" || style.textOverflow === "ellipsis";
        if (
          hidesY &&
          !truncates &&
          element.clientHeight > 0 &&
          element.scrollHeight > element.clientHeight + 1
        ) {
          found.push(
            `${element.tagName.toLowerCase()}.${element.className} ${String(element.scrollHeight)}>${String(element.clientHeight)}`,
          );
        }
      }
      return found;
    });
    expect(clipped).toEqual([]);
  });
}
