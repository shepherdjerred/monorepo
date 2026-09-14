import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loadStorybookStories } from "./storybook-index.ts";

const stories = await loadStorybookStories();

// Both skins and both modes are covered without multiplying the suite by four.
const themes = [
  { skin: "modern", mode: "dark" },
  { skin: "classic", mode: "light" },
] as const;

// A story renders one component, not a document. Page-structure rules fail on
// every story for reasons no component owns.
const pageLevelRules = [
  "region",
  "landmark-one-main",
  "page-has-heading-one",
  "bypass",
];

for (const story of stories) {
  for (const theme of themes) {
    test(`${story.id} [${theme.skin}/${theme.mode}]`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });

      await page.goto(
        `/iframe.html?viewMode=story&id=${story.id}&globals=skin:${theme.skin};mode:${theme.mode}`,
      );

      await expect(page.locator("html")).toHaveAttribute(
        "data-scout-skin",
        theme.skin,
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-scout-mode",
        theme.mode,
      );
      // Mounted, not non-blank: icon-only stories render no text at all.
      await expect(page.locator("#storybook-root > *").first()).toBeAttached();
      await expect(page.locator("body.sb-show-errordisplay")).toHaveCount(0);
      expect(pageErrors).toEqual([]);

      // Champion art and rank crests resolve through scoutAssetsPlugin. A
      // broken URL still renders an element with alt text, so neither the
      // mount check nor axe would notice it.
      const brokenImages = await page
        .locator("img")
        .evaluateAll(async (elements) => {
          const images: HTMLImageElement[] = [];
          for (const element of elements) {
            if (!(element instanceof HTMLImageElement)) {
              throw new TypeError("img locator returned a non-image element");
            }
            images.push(element);
          }
          for (const image of images) image.loading = "eager";
          await Promise.all(
            images.map(async (image) => {
              if (image.complete) return;
              await new Promise<void>((resolve) => {
                const settle = (): void => {
                  resolve();
                };
                image.addEventListener("load", settle, { once: true });
                image.addEventListener("error", settle, { once: true });
                globalThis.setTimeout(settle, 5000);
              });
            }),
          );
          return images
            .filter((image) => image.naturalWidth === 0)
            .map((image) =>
              image.currentSrc === "" ? image.src : image.currentSrc,
            );
        });
      expect(brokenImages).toEqual([]);

      const accessibility = await new AxeBuilder({ page })
        .disableRules(pageLevelRules)
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  }
}
