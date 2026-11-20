import { expect, test, type Page } from "@playwright/test";
import { HubGridSchema } from "#shared/hub/hub-contract.ts";
import {
  api,
  expectNoHorizontalOverflow,
  requestArcadeDeployment,
} from "./helpers.ts";

const NAVIGATION = [
  "Overview",
  "Commits",
  "Pipelines",
  "Deployments",
  "Approvals",
  "Artifacts",
  "Activity",
];

async function openOverview(page: Page, search = "") {
  await page.goto(`/${search}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
}

/** The tile of one service: the list item holding the link to its pipeline. */
function tile(page: Page, title: string) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

test("the overview is home and says what it shows", async ({ page }) => {
  await openOverview(page);
  await expect(page).toHaveURL(/\/$/u);
  await expect(page).toHaveTitle("Overview · Delivery");
  await expect(page.getByRole("main")).toContainText(
    "This is the deployment record, not live runtime health.",
  );
  const main = page.getByRole("navigation", { name: "Main" });
  // Approvals carries a count of what waits, so the names are matched by their start.
  const links = main.getByRole("link");
  await expect(links).toHaveCount(NAVIGATION.length);
  for (const [index, name] of NAVIGATION.entries())
    await expect(links.nth(index)).toHaveText(new RegExp(`^${name}`, "u"));
  await expect(
    main.getByRole("link", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);

  // The seventh item is reachable where the masthead navigation scrolls.
  await main.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  await expect(
    main.getByRole("link", { name: "Overview", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Delivery", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#main-heading")).toBeFocused();

  await page.goto("/no/such/page");
  await page.getByRole("link", { name: "Return to the overview" }).click();
  await expect(page).toHaveURL(/\/$/u);
});

test("attention comes first and names the service and environment", async ({
  page,
}) => {
  await openOverview(page);
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  expect(grid.attention.length).toBeGreaterThan(0);
  const attention = page.getByRole("region", { name: "Needs attention" });
  await expect(attention.getByRole("listitem")).toHaveCount(
    grid.attention.length,
  );
  await expect(attention).toContainText(
    `${String(grid.attention.length)} items`,
  );
  // The Minecraft upgrade's interrupted executor stays quarantined in every run.
  const stuck = attention.getByRole("link", {
    name: "Minecraft tsmc requires recovery",
  });
  await expect(stuck).toBeVisible();
  await expect(
    tile(page, "Minecraft").getByRole("link", {
      name: /^tsmc recovery required/u,
    }),
  ).toHaveAttribute("href", "/environments/minecraft/tsmc");
  // Attention precedes every panel of services in the page.
  const order = await page
    .getByRole("main")
    .getByRole("region")
    .evaluateAll((regions) =>
      regions.map((region) => region.getAttribute("aria-labelledby")),
    );
  expect(order[0]).toBe("attention-heading");
  expect(order).toContain("overview-product");
  await stuck.click();
  await expect(page).toHaveURL(/\/deployments\/[^/]+$/u);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Deployment to minecraft/tsmc",
    }),
  ).toBeVisible();
});

test("each kind is a panel with its counts, and a group of several has its own", async ({
  page,
}) => {
  await openOverview(page);
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  const total = grid.groups.reduce(
    (sum, group) => sum + group.services.length,
    0,
  );
  await expect(page.getByRole("main")).toContainText(
    `${String(total)} services`,
  );
  const panels = page.getByRole("main").locator("section.overview-kind");
  await expect(panels.getByRole("heading", { level: 2 })).toHaveText([
    "Products",
    "Workloads",
    "Platform",
  ]);
  // Other specs deploy to the products, so their standings move between
  // runs; a panel's counts always add up to the services it lists.
  const products = page.getByRole("region", { name: "Products", exact: true });
  const labels = await products
    .getByRole("list", { name: "Products by status" })
    .getByRole("listitem")
    .allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  const counted = labels.reduce(
    (sum, label) => sum + Number(/\d+/u.exec(label)?.[0] ?? Number.NaN),
    0,
  );
  await expect(products.locator(".overview-tile")).toHaveCount(counted);
  // Platform services holds the two seeded v2-only services beside its own.
  const platform = page.getByRole("region", { name: "Platform", exact: true });
  const group = platform.getByRole("region", { name: "Platform services" });
  await expect(
    group.getByRole("heading", { level: 3, name: "Platform services" }),
  ).toBeVisible();
  const counts = group.getByRole("list", {
    name: "Platform services by status",
  });
  await expect(counts.getByRole("listitem")).toHaveText([
    /1 not started$/u,
    /2 no environments$/u,
  ]);
  await expect(
    group.getByRole("link", { name: "Flipt", exact: true }),
  ).toHaveAttribute("href", "/pipelines/flipt");
  await expect(tile(page, "1Password Connect")).toContainText(
    "No environments",
  );
  await expect(
    tile(page, "Flipt").getByRole("link", { name: "prod not started" }),
  ).toHaveAttribute("href", "/environments/flipt/prod");
  await expectNoHorizontalOverflow(page);
});

test("a tile links its service and each environment chip", async ({ page }) => {
  await openOverview(page);
  const scout = tile(page, "Scout for LoL");
  const chips = scout.getByRole("list", {
    name: "Scout for LoL environments",
  });
  // Name, status words, accepted revision and when it was accepted.
  const prod = chips.getByRole("link", {
    name: /^prod \S.* r\d+ accepted \S/u,
  });
  await expect(prod).toHaveAttribute(
    "href",
    "/environments/scout-for-lol/prod",
  );
  await prod.click();
  await expect(page).toHaveURL(/\/environments\/scout-for-lol\/prod$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "scout-for-lol/prod" }),
  ).toBeVisible();
  await expect(page.locator("#main-heading")).toBeFocused();
  await page.goBack();
  await scout.getByRole("link", { name: "Scout for LoL", exact: true }).click();
  await expect(page).toHaveURL(/\/pipelines\/scout-for-lol$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
});

test("the overview filters through the URL", async ({ page }) => {
  await openOverview(page);
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  const total = grid.groups.reduce(
    (sum, group) => sum + group.services.length,
    0,
  );
  const tiles = page.getByRole("main").locator(".overview-tile");
  await expect(tiles).toHaveCount(total);
  const filters = page.getByRole("search", { name: "Filter services" });
  await filters.getByLabel("Service").fill("flipt");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/\?q=flipt$/u);
  await expect(tiles).toHaveCount(1);
  await expect(page.getByRole("main")).toContainText(
    `1 of ${String(total)} services`,
  );
  // The matching service keeps its group heading; the other kinds are gone.
  await expect(
    page.getByRole("region", { name: "Platform services" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Products", exact: true }),
  ).toHaveCount(0);

  await filters.getByLabel("Newest deployment").selectOption("succeeded");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/\?q=flipt&status=succeeded$/u);
  await expect(page.getByRole("main")).toContainText(
    "No services match these filters.",
  );
  await expect(tiles).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/\?q=flipt$/u);
  await expect(tiles).toHaveCount(1);
  await page.goBack();
  await expect(tiles).toHaveCount(total);

  // A deep link carries the filter, and a status alone filters too.
  await openOverview(page, "?status=not_started");
  await expect(filters.getByLabel("Newest deployment")).toHaveValue(
    "not_started",
  );
  await expect(tile(page, "Flipt")).toBeVisible();
  await expect(tile(page, "1Password Connect")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("tiles fill the width on a desktop and stack on a phone", async ({
  page,
}) => {
  await openOverview(page);
  const lefts = await page
    .getByRole("region", { name: "Products", exact: true })
    .locator(".overview-tile")
    .evaluateAll((tiles) =>
      tiles.map((entry) => Math.round(entry.getBoundingClientRect().left)),
    );
  expect(lefts.length).toBeGreaterThan(3);
  const columns = new Set(lefts).size;
  const phone = (page.viewportSize()?.width ?? 0) <= 720;
  if (phone) expect(columns).toBe(1);
  else expect(columns).toBeGreaterThan(2);
  await expectNoHorizontalOverflow(page);
});

test("a deployment moves its tile without a reload", async ({
  page,
  baseURL,
}) => {
  await openOverview(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();
  const { deployment, cancel } = await requestArcadeDeployment(page, baseURL);
  const chip = tile(page, "Arcade").getByRole("link", { name: /^prod / });
  await expect(chip).toContainText(deployment.status.replaceAll("_", " "));
  await cancel();
  await expect(chip).toContainText("canceled");
});
