import { expect, test } from "@playwright/test";
import { HubGridSchema } from "#shared/hub/hub-contract.ts";
import {
  api,
  expectContainedInTiles,
  expectNoHorizontalOverflow,
  isPhone,
  mainNav,
  openOverview,
  overviewTile as tile,
  requestArcadeDeployment,
  showAllAttention,
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

test("the overview is home and says what it shows", async ({ page }) => {
  await openOverview(page);
  await expect(page).toHaveURL(/\/$/u);
  await expect(page).toHaveTitle("Overview · Delivery");
  await expect(page.getByRole("main")).toContainText(
    "This is the deployment record, not live runtime health.",
  );
  const main = await mainNav(page);
  // Approvals carries a count of what waits, so the names are matched by their start.
  const links = main.getByRole("link");
  await expect(links).toHaveCount(NAVIGATION.length);
  for (const [index, name] of NAVIGATION.entries())
    await expect(links.nth(index)).toHaveText(new RegExp(`^${name}`, "u"));
  await expect(
    main.getByRole("link", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  if (await drawer.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }
  await expectNoHorizontalOverflow(page);

  // The seventh item is reachable from primary navigation.
  const navBeforeClick = await mainNav(page);
  await navBeforeClick
    .getByRole("link", { name: "Activity", exact: true })
    .click();
  await expect(page).toHaveURL(/\/activity$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  const afterNav = await mainNav(page);
  await expect(
    afterNav.getByRole("link", { name: "Overview", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await afterNav.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  await expectNoHorizontalOverflow(page);

  await page.goto("/no/such/page");
  await page.getByRole("link", { name: "Return to the overview" }).click();
  await expect(page).toHaveURL(/\/$/u);
});

test("attention comes first and names the service and environment", async ({
  page,
}) => {
  const attention = await openOverview(page, "", { attention: "collapsed" });
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  expect(grid.attention.length).toBeGreaterThan(0);
  // Like Pipelines, a long list shows its first five behind "Show all".
  await expect(attention.getByRole("listitem")).toHaveCount(
    Math.min(grid.attention.length, 5),
  );
  await expect(attention).toContainText(
    `${String(grid.attention.length)} items`,
  );
  await showAllAttention(page);
  // The Minecraft upgrade's interrupted executor stays quarantined in every run.
  const stuck = attention.getByRole("link", {
    name: "Minecraft tsmc requires recovery",
  });
  await expect(stuck).toBeVisible();
  await expect(
    tile(page, "Minecraft").getByRole("link", {
      name: /^tsmc .*recovery required/u,
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

test("every attention row keeps its kind, lead, summary and time in the same columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openOverview(page);
  const items = page
    .getByRole("region", { name: "Needs attention" })
    .getByRole("listitem");
  await expect(items.first()).toBeVisible();
  const cells = await items.evaluateAll((rows) =>
    rows.map((row) => {
      const box = (selector: string) => {
        const rect = row.querySelector(selector)?.getBoundingClientRect();
        return rect === undefined
          ? null
          : { x: rect.x, right: rect.right, top: rect.top };
      };
      return {
        lead: box(".attention-lead"),
        summary: box(".attention-summary"),
        when: box(".attention-when"),
      };
    }),
  );
  expect(cells.length).toBeGreaterThan(1);
  for (const row of cells) {
    if (row.lead === null || row.summary === null)
      throw new Error("every row has a lead and a summary");
    // One line of cells: the summary and time start level with the lead.
    expect(Math.abs(row.summary.top - row.lead.top)).toBeLessThan(4);
    if (row.when !== null)
      expect(Math.abs(row.when.top - row.lead.top)).toBeLessThan(4);
  }
  // The same columns on every row, wherever a row's words end.
  const leads = new Set(cells.map((row) => Math.round(row.lead?.x ?? -1)));
  const summaries = new Set(
    cells.map((row) => Math.round(row.summary?.x ?? -1)),
  );
  const times = new Set(
    cells.flatMap((row) =>
      row.when === null ? [] : [Math.round(row.when.right)],
    ),
  );
  expect([leads.size, summaries.size, times.size]).toEqual([1, 1, 1]);
  await expectNoHorizontalOverflow(page);
});

test("a chip shows the accepted release apart from a newer request, each with its own status", async ({
  page,
}) => {
  await openOverview(page);
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  const birmel = grid.groups
    .flatMap((group) => group.services)
    .find((service) => service.id === "birmel")?.environments[0];
  if (birmel?.request === null || birmel?.request === undefined)
    throw new Error("Birmel prod's queued request fixture required");
  const accepted = `r${String(birmel.acceptedRevision)}`;
  const queued = `r${String(birmel.request.revision)}`;
  expect(accepted).not.toBe(queued);
  const chip = tile(page, "Birmel").getByRole("link", { name: /^prod / });
  // The accepted release with its own status and age, then the newer request's own number and status.
  await expect(chip).toHaveAccessibleName(
    new RegExp(`^prod accepted ${accepted} .+ ${queued} queued$`, "u"),
  );
  await expect(chip).not.toContainText(`${accepted} queued`);
  // Every chip carries a status glyph and words, a newer request or not.
  await expect(chip.locator(".status")).toHaveCount(2);
  for (const each of await page.locator("a.overview-chip").all())
    await expect(each.locator(".status-glyph").first()).toHaveCount(1);

  // A deployment queued past the threshold with no stage started needs someone.
  const attention = page.getByRole("region", { name: "Needs attention" });
  const item = attention
    .getByRole("listitem")
    .filter({ hasText: "Birmel prod deployment is still queued" });
  await expect(item).toContainText(
    `The deploy of ${queued} has started no stage since it was requested, more than 15 minutes ago.`,
  );
  await expect(
    item.getByRole("link", { name: "Birmel prod deployment is still queued" }),
  ).toHaveAttribute("href", "/deployments/birmel-queued");
  await expectNoHorizontalOverflow(page);
});

test("each attention item says what failed instead of the executor boilerplate", async ({
  page,
}) => {
  await openOverview(page);
  const items = page
    .getByRole("region", { name: "Needs attention" })
    .getByRole("listitem");
  const details = await items.locator(".muted").allTextContents();
  expect(details.length).toBeGreaterThan(1);
  // Each recovery says what failed, not the executor's shared boilerplate.
  for (const detail of details) {
    expect(detail).not.toContain("External operation may still be active");
    expect(detail).toMatch(/\S/u);
  }
  await expect(
    items.filter({ hasText: "Minecraft tsmc requires recovery" }),
  ).toContainText(/The \S+ of r\d+ failed and left the environment locked\./u);
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
  // runs; a panel's counts always add up to the tiles directly under it,
  // and each group under it counts its own.
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
  await expect(
    products.locator(".overview-tile:not(.overview-group .overview-tile)"),
  ).toHaveCount(counted);
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
    group.getByRole("link", { name: "Node feature discovery", exact: true }),
  ).toHaveAttribute("href", "/pipelines/nfd");
  await expect(tile(page, "1Password Connect")).toContainText(
    "No environments",
  );
  await expect(
    tile(page, "Node feature discovery").getByRole("link", {
      name: "prod not started",
    }),
  ).toHaveAttribute("href", "/environments/nfd/prod");
  await expectNoHorizontalOverflow(page);
});

test("a tile links its service and each environment chip", async ({ page }) => {
  await openOverview(page);
  const scout = tile(page, "Scout for LoL");
  // A phone folds a service that needs nobody; open it to reach its chips.
  if (isPhone(page) && !(await scout.isVisible()))
    await page
      .getByRole("region", { name: "Products", exact: true })
      .locator("summary", { hasText: "healthy" })
      .click();
  const chips = scout.getByRole("list", {
    name: "Scout for LoL environments",
  });
  // Name, status words, accepted revision and when it was accepted.
  const prod = chips.getByRole("link", {
    name: /^prod accepted r\d+ \S|^prod .*\br\d+ accepted \S/u,
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
  // Going back reloads the overview with the phone's fold closed again.
  if (isPhone(page) && !(await scout.isVisible()))
    await page
      .getByRole("region", { name: "Products", exact: true })
      .locator("summary", { hasText: "healthy" })
      .click();
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
  await filters.getByLabel("Service").fill("nfd");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/\?q=nfd$/u);
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
  await expect(page).toHaveURL(/\/\?q=nfd&status=succeeded$/u);
  await expect(page.getByRole("main")).toContainText(
    "No services match these filters.",
  );
  await expect(tiles).toHaveCount(0);

  // A submit keeps focus on its button; the form is not remounted.
  await expect(filters.getByRole("button", { name: "Filter" })).toBeFocused();

  // The controls follow the URL through history, not what was last chosen.
  await page.goBack();
  await expect(page).toHaveURL(/\/\?q=nfd$/u);
  await expect(tiles).toHaveCount(1);
  await expect(filters.getByLabel("Service")).toHaveValue("nfd");
  await expect(filters.getByLabel("Newest deployment")).toHaveValue("");
  await page.goBack();
  await expect(filters.getByLabel("Service")).toHaveValue("");
  await expect(tiles).toHaveCount(total);
  await page.goForward();
  await expect(page).toHaveURL(/\/\?q=nfd$/u);
  await expect(filters.getByLabel("Service")).toHaveValue("nfd");
  await expect(tiles).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/\?q=nfd&status=succeeded$/u);
  await expect(filters.getByLabel("Service")).toHaveValue("nfd");
  await expect(filters.getByLabel("Newest deployment")).toHaveValue(
    "succeeded",
  );
  await expect(tiles).toHaveCount(0);

  // A submit trims what was typed, and the control still follows the URL.
  await openOverview(page);
  await filters.getByLabel("Service").fill("  nfd ");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/\?q=nfd$/u);
  await expect(filters.getByLabel("Service")).toHaveValue("nfd");
  await page.goBack();
  await expect(tiles).toHaveCount(total);
  await expect(filters.getByLabel("Service")).toHaveValue("");

  // A deep link carries the filter, and a status alone filters too.
  await openOverview(page, "?status=not_started");
  await expect(filters.getByLabel("Newest deployment")).toHaveValue(
    "not_started",
  );
  await expect(tile(page, "Node feature discovery")).toBeVisible();
  await expect(tile(page, "1Password Connect")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("tiles fill the width on a desktop and sit two to a row on a phone", async ({
  page,
}) => {
  await openOverview(page);
  // Wait for the tiles to settle before measuring them.
  await expect(
    page
      .getByRole("region", { name: "Products", exact: true })
      .locator(".overview-tile")
      .first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const lefts = await page
    .getByRole("region", { name: "Products", exact: true })
    .locator(".overview-tile")
    .evaluateAll((tiles) =>
      tiles
        .filter((entry) => entry.checkVisibility())
        .map((entry) => Math.round(entry.getBoundingClientRect().left)),
    );
  expect(lefts.length).toBeGreaterThan(3);
  const columns = new Set(lefts).size;
  if (isPhone(page)) expect(columns).toBe(2);
  else expect(columns).toBeGreaterThan(2);
  await expectNoHorizontalOverflow(page);
});

test("every chip stays inside its tile", async ({ page }) => {
  await openOverview(page);
  await expectContainedInTiles(page);
  // A phone's narrow tiles are the hardest case; check that width too.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectContainedInTiles(page);
});

test("a phone folds the services that need nobody behind a closed count", async ({
  page,
}) => {
  await openOverview(page);
  const products = page.getByRole("region", { name: "Products", exact: true });
  const fold = products.locator("details", {
    has: page.locator("summary", { hasText: "healthy" }),
  });
  if (!isPhone(page)) {
    // A wide screen shows every tile.
    await expect(
      page.locator("main details", { hasText: "healthy" }),
    ).toHaveCount(0);
    return;
  }
  await expect(fold).toHaveJSProperty("open", false);
  // The count reads as a count of healthy services, never as zero things.
  await expect(fold.locator("summary")).toHaveText(/^(?:All )?\d+ healthy$/u);
  // What needs a person stays in sight: a service that requires recovery.
  await expect(tile(page, "Minecraft")).toBeVisible();
  await fold.locator("summary").click();
  await expect(fold.locator(".overview-tile").first()).toBeVisible();
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
