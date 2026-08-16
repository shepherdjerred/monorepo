import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const themes = [
  { skin: "modern", mode: "light" },
  { skin: "modern", mode: "dark" },
  { skin: "classic", mode: "light" },
  { skin: "classic", mode: "dark" },
] as const;

for (const theme of themes) {
  test(`${theme.skin} ${theme.mode} catalog`, async ({ page }) => {
    await page.addInitScript((preference) => {
      localStorage.setItem(
        "scout-theme-v1",
        JSON.stringify({ version: 1, ...preference }),
      );
    }, theme);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute(
      "data-scout-skin",
      theme.skin,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-scout-mode",
      theme.mode,
    );
    await page.locator("img").evaluateAll(async (elements) => {
      const images: HTMLImageElement[] = [];
      for (const element of elements) {
        if (!(element instanceof HTMLImageElement)) {
          throw new TypeError("img locator returned a non-image element");
        }
        images.push(element);
      }
      for (const image of images) image.loading = "eager";
      await Promise.all(
        images.map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete) {
                resolve();
                return;
              }
              image.addEventListener(
                "load",
                () => {
                  resolve();
                },
                { once: true },
              );
              image.addEventListener(
                "error",
                () => {
                  resolve();
                },
                { once: true },
              );
            }),
        ),
      );
      await Promise.all(images.map((image) => image.decode()));
    });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await expect(page).toHaveScreenshot(`${theme.skin}-${theme.mode}.png`, {
      fullPage: true,
      animations: "disabled",
    });
  });
}
