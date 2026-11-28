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

// Both skins and both modes of the modern skin, plus classic light, without
// multiplying the suite by four. Modern light is the mode the soft surfaces
// are tuned against, so it runs alongside modern dark.
const themes = [
  { skin: "modern", mode: "dark" },
  { skin: "modern", mode: "light" },
  { skin: "classic", mode: "light" },
] as const;

const themeTokens = (theme: (typeof themes)[number]) => {
  return scoutThemes[`${theme.skin}-${theme.mode}`];
};

/**
 * The production CSS minifier writes `#ffffff` as `#fff`, so a computed custom
 * property and the token JSON can name the same colour differently.
 */
function normalizeHex(value: string): string {
  const hex = value.trim().toLowerCase();
  return hex.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3");
}

// Each story owns its browser context; use the three bounded CI workers even
// though the catalog is generated into a single spec file.
test.describe.configure({ mode: "parallel" });

for (const story of stories) {
  for (const theme of themes) {
    test(`${story.id} [${theme.skin}/${theme.mode}]`, async ({ page }) => {
      const pageErrors = await mountStory(page, { id: story.id, ...theme });

      const expectedColors = themeTokens(theme).colors;
      await expect
        .poll(async () => {
          const computed = await page.locator("html").evaluate((root) => {
            const styles = getComputedStyle(root);
            return {
              canvas: styles.getPropertyValue("--scout-color-canvas"),
              surface: styles.getPropertyValue("--scout-color-surface"),
              text: styles.getPropertyValue("--scout-color-text"),
              textMuted: styles.getPropertyValue("--scout-color-text-muted"),
            };
          });
          return {
            canvas: normalizeHex(computed.canvas),
            surface: normalizeHex(computed.surface),
            text: normalizeHex(computed.text),
            textMuted: normalizeHex(computed.textMuted),
          };
        })
        .toEqual({
          canvas: normalizeHex(expectedColors.canvas),
          surface: normalizeHex(expectedColors.surface),
          text: normalizeHex(expectedColors.text),
          textMuted: normalizeHex(expectedColors.textMuted),
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
