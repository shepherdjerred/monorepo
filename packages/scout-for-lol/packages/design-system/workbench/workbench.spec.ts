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

test("semantic form examples preserve native browser behavior", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Semantic form states" });
  const title = form.locator('input[name="title"]');
  const email = form.locator('input[name="email"]');

  await expect(title).toHaveAttribute("required", "");
  await expect(email).toHaveAttribute("type", "email");
  expect(
    await form.evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) {
        throw new TypeError("form locator returned a non-form element");
      }
      return element.checkValidity();
    }),
  ).toBe(false);
  expect(
    await title.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) {
        throw new TypeError("title locator returned a non-input element");
      }
      return element.validationMessage;
    }),
  ).not.toBe("");
  await expect(form.locator('[aria-invalid="true"]')).toHaveAttribute(
    "aria-describedby",
    "form-zod-invalid-error",
  );
  await expect(form.locator('input[name="disabled-value"]')).toBeDisabled();

  await title.fill("Changed title");
  await form.getByRole("button", { name: "Reset" }).click();
  await expect(title).toHaveValue("");
});
