import { expect, test } from "@playwright/test";
import { scoutThemes } from "#src/generated/tokens.ts";
import {
  expectStoryAccessible,
  loadStorybookStories,
  mountStory,
} from "#src/storybook/e2e.ts";

const stories = await loadStorybookStories(
  new URL("../storybook-static/index.json", import.meta.url),
);

// Both skins and both modes, without multiplying the suite by four.
const themes = [
  { skin: "modern", mode: "dark" },
  { skin: "classic", mode: "light" },
] as const;

const themeTokens = (theme: (typeof themes)[number]) => {
  return theme.skin === "modern"
    ? scoutThemes["modern-dark"]
    : scoutThemes["classic-light"];
};

for (const story of stories) {
  for (const theme of themes) {
    test(`${story.id} [${theme.skin}/${theme.mode}]`, async ({ page }) => {
      const pageErrors = await mountStory(page, { id: story.id, ...theme });

      const expectedColors = themeTokens(theme).colors;
      await expect
        .poll(async () =>
          page.locator("html").evaluate((root) => {
            const styles = getComputedStyle(root);
            return {
              canvas: styles
                .getPropertyValue("--scout-color-canvas")
                .trim()
                .toLowerCase(),
              surface: styles
                .getPropertyValue("--scout-color-surface")
                .trim()
                .toLowerCase(),
              text: styles
                .getPropertyValue("--scout-color-text")
                .trim()
                .toLowerCase(),
              textMuted: styles
                .getPropertyValue("--scout-color-text-muted")
                .trim()
                .toLowerCase(),
            };
          }),
        )
        .toEqual({
          canvas: expectedColors.canvas.toLowerCase(),
          surface: expectedColors.surface.toLowerCase(),
          text: expectedColors.text.toLowerCase(),
          textMuted: expectedColors.textMuted.toLowerCase(),
        });

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

      await expectStoryAccessible(page);

      // Assert last: a delayed pageerror raised during the axe pass or by a
      // late effect still fails the test, not just ones thrown before this
      // point.
      expect(pageErrors).toEqual([]);
    });
  }
}
