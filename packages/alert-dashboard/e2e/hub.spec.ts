import { expect, test, type Page } from "@playwright/test";

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Search and commands" });
  await expect(palette).toBeVisible();
  return palette;
}

test("the palette opens from the keyboard and the sidebar, and closes on Escape", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("main h1")).toHaveText("Home");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox", { name: "Search and commands" });
  await expect(input).toBeFocused();
  await expect(
    palette.getByRole("group", { name: "Pages" }).getByRole("option"),
  ).toHaveCount(19);
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
  await expect(options).toHaveText(["Go to History", "Incident history"]);
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/history$/u);

  const reopened = await openPalette(page);
  await expect(reopened.getByRole("combobox")).toHaveValue("");
  await expect(reopened.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    reopened.getByRole("option", { name: "Go to Cluster" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  // ArrowUp from the first option wraps to the last: commands follow module
  // order, so that is the incidents module's last command.
  await expect(
    reopened.getByRole("option", { name: "Declare incident" }),
  ).toHaveAttribute("aria-selected", "true");

  await reopened.getByRole("combobox").fill("chores");
  await expect(
    reopened.getByRole("group", { name: "Pages" }).getByRole("option"),
  ).toHaveText(["Go to House"]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/house$/u);
  await expect(page).toHaveTitle("House · Hub");
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

  const packagesPalette = await openPalette(page);
  await packagesPalette.getByRole("combobox").fill("@shepherdjerred/homelab");
  const packages = packagesPalette.getByRole("group", { name: "Packages" });
  const homelabPkg = packages.getByRole("option", {
    name: /@shepherdjerred\/homelab/u,
  });
  await expect(homelabPkg).toContainText("packages/homelab · infra");
  await homelabPkg.click();
  await expect(page).toHaveURL(/\/monorepo$/u);

  const renovatePalette = await openPalette(page);
  await renovatePalette.getByRole("combobox").fill("prisma");
  const renovateGroup = renovatePalette.getByRole("group", {
    name: "Renovate",
  });
  const prismaItem = renovateGroup.getByRole("option", { name: /prisma/u });
  await expect(prismaItem).toContainText("→ 8.0.0 · awaiting-approval");
  await prismaItem.click();
  await expect(page).toHaveURL(/\/renovate$/u);

  const golinkPalette = await openPalette(page);
  await golinkPalette.getByRole("combobox").fill("go/graf");
  const golinks = golinkPalette.getByRole("group", { name: "Golinks" });
  const grafLink = golinks.getByRole("option", { name: /go\/graf/u });
  await expect(grafLink).toBeVisible();
  await grafLink.click();
  await expect(page).toHaveURL(/\/services\/golink$/u);
});

test("a palette command switches the theme", async ({ page }) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("dark theme");
  await expect(palette.getByRole("option")).toHaveText(["Use dark theme"]);
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("results from a previous query cannot be opened by a newer one", async ({
  page,
}) => {
  await page.goto("/");
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await input.fill("scout");
  await expect(
    palette.getByRole("option", { name: /Scout for LoL/u }),
  ).toBeVisible();
  // Enter lands before the debounced search for the new query has run.
  await input.fill("dark theme");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(/\/$/u);
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
