import { expect, test } from "@playwright/test";
import { HubGridSchema, HubOverviewSchema } from "#shared/hub/hub-contract.ts";
import { api, expectNoHorizontalOverflow } from "./helpers.ts";

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
  await filters.getByLabel("Stage status").selectOption("failed");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/pipelines\?status=failed$/u);
  await expect(row("Minecraft")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});

test("the pipelines list shows the first five attention items and the rest on request, so the table starts near the top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // What the shared fixture needs attention for changes as other tests run,
  // so this one reads the list with eight items.
  const total = 8;
  await page.route("**/api/v1/hub", async (route) => {
    const response = await route.fetch();
    const overview = HubOverviewSchema.parse(await response.json());
    overview.attention = Array.from({ length: total }, (_, index) => ({
      kind: "failed",
      title: `Fixture deployment ${String(index + 1)} failed`,
      detail: "The deploy failed and left the environment locked.",
      at: new Date(Date.UTC(2026, 10, 20, 9, 0, index)).toISOString(),
      target: { kind: "deployment", id: `attention-fixture-${String(index)}` },
      serviceId: "arcade",
    }));
    await route.fulfill({ response, json: overview });
  });
  await page.goto("/pipelines");
  const region = page.getByRole("region", { name: "Needs attention" });
  const items = region.getByRole("listitem");
  await expect(items).toHaveCount(5);
  await expect(region).toContainText(`${String(total)} items`);
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  // The list is the page's point: its header is on the first screen.
  const header = await table.locator("thead").boundingBox();
  expect(header?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(900);

  const show = region.getByRole("button", {
    name: `Show all ${String(total)}`,
  });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await show.click();
  await expect(items).toHaveCount(total);
  const hide = region.getByRole("button", { name: "Show fewer" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(items).toHaveCount(5);
});

test("the overview lists every attention item, as its point", async ({
  page,
}) => {
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Needs attention" }).getByRole("listitem"),
  ).toHaveCount(grid.attention.length);
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
