import { expect, test } from "@playwright/test";

function storyUrl(id: string, globals?: string): string {
  const suffix = globals === undefined ? "" : `&globals=${globals}`;
  return `/iframe.html?viewMode=story&id=${id}${suffix}`;
}

const THEME_MENU = storyUrl("runtime-thememenu--default");

test("theme changes synchronize between tabs", async ({ context, page }) => {
  const secondPage = await context.newPage();
  await Promise.all([page.goto(THEME_MENU), secondPage.goto(THEME_MENU)]);
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
  // The mode global has to agree with the seeded preference, otherwise the
  // toolbar decorator seeds a concrete mode over "system" on mount.
  await page.goto(storyUrl("runtime-thememenu--default", "mode:system"));
  await expect(page.locator("html")).toHaveAttribute("data-scout-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-mode",
    "light",
  );
});

test("theme menu is operable by keyboard", async ({ page }) => {
  await page.goto(THEME_MENU);
  await page.getByRole("button", { name: "Choose Scout theme" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Classic" }).press("Enter");
  await expect(page.locator("html")).toHaveAttribute(
    "data-scout-skin",
    "classic",
  );
});

test("dialog traps focus and restores it to the trigger", async ({ page }) => {
  await page.goto(storyUrl("components-overlays-dialog--create-report"));
  const trigger = page.getByRole("button", { name: "Create report" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("disabled button reports its accessible state", async ({ page }) => {
  await page.goto(storyUrl("components-button--disabled"));
  await expect(page.getByRole("button", { name: "Disabled" })).toBeDisabled();
});

test("switch toggles and reports checked state", async ({ page }) => {
  await page.goto(storyUrl("components-forms-switch--default"));
  const publish = page.getByRole("switch", { name: "Publish automatically" });
  await publish.click();
  await expect(publish).toBeChecked();
});

test("tabs reveal their associated panel", async ({ page }) => {
  await page.goto(storyUrl("components-tabs--default"));
  const details = page.getByRole("tab", { name: "Details" });
  await details.click();
  await expect(details).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
});
