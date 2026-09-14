import { expect, test } from "@playwright/test";
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

for (const story of stories) {
  for (const theme of themes) {
    test(`${story.id} [${theme.skin}/${theme.mode}]`, async ({ page }) => {
      const pageErrors = await mountStory(page, { id: story.id, ...theme });
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

      await expectStoryAccessible(page);
    });
  }
}
