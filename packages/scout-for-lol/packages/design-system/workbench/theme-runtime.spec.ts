import AxeBuilder from "@axe-core/playwright";
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

test("promoted Activity controls preserve overlays, dismissal, and accessibility", async ({
  page,
}) => {
  await page.goto("/promoted-controls");

  const tooltipTrigger = page.getByRole("button", { name: "Roster help" });
  await tooltipTrigger.focus();
  await expect(page.getByRole("tooltip")).toHaveText("First ten ready players");

  const alertTrigger = page.getByRole("button", {
    name: "End custom night",
  });
  await alertTrigger.click();
  await expect(
    page.getByRole("alertdialog", { name: "End this custom night?" }),
  ).toBeVisible();
  const alertAccessibility = await new AxeBuilder({ page }).analyze();
  expect(alertAccessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Keep playing" }).click();
  await expect(alertTrigger).toBeFocused();

  const drawerTrigger = page.getByRole("button", {
    name: "Open mobile roster",
  });
  await drawerTrigger.click();
  await expect(
    page.getByRole("dialog", { name: "Mobile roster" }),
  ).toBeVisible();
  const drawerAccessibility = await new AxeBuilder({ page })
    // Base UI adds role=button only to these hidden focus guards in WebKit so
    // VoiceOver's virtual cursor participates in the focus trap.
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  expect(drawerAccessibility.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(drawerTrigger).toBeFocused();

  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Custom night created")).toBeVisible();
});
