import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";

test("the pipelines list names the CI run and shows every stage's own state", async ({
  page,
}) => {
  await page.goto("/pipelines");
  const table = page.getByRole("table");
  // A column header on a desktop, a cell label on a phone.
  await expect(
    table.locator('td[data-label="Latest CI run"]').first(),
  ).toBeVisible();
  await expect(table.locator("thead")).toContainText("Latest CI run");
  const row = (title: string) =>
    table.getByRole("row").filter({
      has: page.getByRole("link", { name: title, exact: true }),
    });
  // The number is the Woodpecker run's, which every service it built shares.
  await expect(
    row("Arcade").getByRole("link", { name: "CI run #1", exact: true }),
  ).toBeVisible();
  // A passed CI run sits beside a stage that requires recovery; neither hides the other.
  await expect(
    row("Minecraft").getByRole("link", { name: "recovery required tsmc" }),
  ).toHaveAttribute("href", "/environments/minecraft/tsmc");

  const filters = page.getByRole("search", { name: "Filter pipelines" });
  await filters.getByLabel("A stage is").selectOption("failed");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/pipelines\?status=failed$/u);
  await expect(row("Minecraft")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});

test("the pipelines list leads with what needs attention and dates builds and deployments apart", async ({
  page,
}) => {
  await page.goto("/pipelines");
  // allTextContents does not wait; read the headings once the page has them.
  await expect(
    page.getByRole("main").getByRole("heading", { level: 2 }).first(),
  ).toBeVisible();
  const order = await page
    .getByRole("main")
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(order[0]).toBe("Needs attention");
  const table = page.getByRole("table");
  await expect(table.locator("thead")).toContainText("Last activity");
  const arcade = table.getByRole("row").filter({
    has: page.getByRole("link", { name: "Arcade", exact: true }),
  });
  const last = arcade.locator('td[data-label="Last activity"]');
  await expect(last).toContainText(/Last build \S/u);
  await expect(last).toContainText(/Last deployment \S/u);
  await expect(table).not.toContainText("Last executed");
});
