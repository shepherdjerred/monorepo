import { expect, test, type Page } from "@playwright/test";

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  return palette;
}

test("the palette opens from the keyboard and the header, and closes on Escape", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Search and commands" });
  await expect(input).toBeFocused();
  await expect(
    palette.getByRole("group", { name: "Pages" }).getByRole("option"),
  ).toHaveCount(11);
  await expect(
    palette.getByRole("option", { name: "Open Tracker" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await page.getByRole("button", { name: "Search and commands" }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeHidden();
});

test("the palette filters pages and navigates with the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("hist");
  const options = palette.getByRole("option");
  await expect(options).toHaveText(["Go to History"]);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/history$/u);

  const reopened = await openPalette(page);
  await expect(reopened.getByRole("combobox")).toHaveValue("");
  await page.keyboard.press("ArrowDown");
  await expect(
    reopened.getByRole("option", { name: "Go to Overview" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(
    reopened.getByRole("option", { name: "Use system theme" }),
  ).toHaveAttribute("aria-selected", "true");
});

test("the palette searches catalog services and recent alerts", async ({
  page,
}) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("scout");
  const services = palette.getByRole("group", { name: "Services" });
  await expect(
    services.getByRole("option", { name: /Scout for LoL/u }),
  ).toBeVisible();
  await services.getByRole("option", { name: /Scout for LoL/u }).click();
  await expect(page).toHaveURL(/\/services\/scout-for-lol$/u);
  await expect(
    page.getByRole("heading", { name: "Scout for LoL", level: 1 }),
  ).toBeVisible();

  const again = await openPalette(page);
  await again.getByRole("combobox").fill("storage");
  const alerts = again.getByRole("group", { name: "Alerts" });
  const alert = alerts.getByRole("option", {
    name: /Storage volume is nearly full/u,
  });
  await expect(alert).toContainText("DiskFull · open");
  await alert.click();
  await expect(page).toHaveURL(/\/alerts\/alert_a{32}$/u);
});

test("a palette command switches the theme", async ({ page }) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("dark theme");
  await expect(palette.getByRole("option")).toHaveText(["Use dark theme"]);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the palette fits a phone without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Search and commands" }).click();
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  const box = await palette.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
});
