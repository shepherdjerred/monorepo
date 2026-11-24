import { expect } from "@playwright/test";
import { ROUTES } from "#e2e/browser/routes.ts";
import { horizontalOverflow, open, test } from "#e2e/browser/support.ts";

/**
 * WCAG 1.4.10 reflow: at 320 CSS pixels wide, which is also a 1280 pixel
 * window at 400 percent zoom, and at 720, which is 1440 at 200 percent, no
 * page scrolls sideways. A narrow desktop window, not a phone: a phone's
 * layout width is its device width whatever the window.
 */
for (const width of [320, 720]) {
  test.describe(`${String(width)} CSS pixels wide`, () => {
    test.use({ viewport: { width, height: 700 } });

    for (const route of ROUTES) {
      test(`${route.label} does not scroll sideways`, async ({
        page,
        baseURL,
      }) => {
        if (baseURL === undefined) {
          throw new Error("The project has no baseURL");
        }
        await open(page, route, baseURL);
        expect(await horizontalOverflow(page)).toBe(0);
      });
    }
  });
}
