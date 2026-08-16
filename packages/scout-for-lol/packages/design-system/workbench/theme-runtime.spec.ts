import { expect, test } from "@playwright/test";

test("theme changes synchronize between tabs", async ({ context, page }) => {
  const secondPage = await context.newPage();
  await Promise.all([page.goto("/"), secondPage.goto("/")]);
  await page.getByRole("button", { name: "Choose Scout theme" }).click();
  await page.getByRole("button", { name: "Classic" }).click();
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );
});

test("system mode reacts to system appearance and pre-paint attributes exist", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "scout-theme-v1",
      JSON.stringify({ version: 1, skin: "modern", mode: "system" }),
    );
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-scout-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );
});

test("catalog controls preserve keyboard, focus, and accessible state", async ({
  page,
}) => {
  await page.goto("/");

  const themeTrigger = page.getByRole("button", {
    name: "Choose Scout theme",
  });
  await themeTrigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Classic" }).press("Enter");
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );

  const dialogTrigger = page.getByRole("button", { name: "Open dialog" });
  await dialogTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create report" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(dialogTrigger).toBeFocused();

  const disabled = page.getByRole("button", { name: "Disabled" });
  await expect(disabled).toBeDisabled();

  const publish = page.getByRole("switch", { name: "Publish automatically" });
  await publish.click();
  await expect(publish).toBeChecked();

  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByText("Stable semantics across skins.")).toBeVisible();
});
