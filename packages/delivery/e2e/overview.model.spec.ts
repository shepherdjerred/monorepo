import { expect, test } from "@playwright/test";
import { HubGridSchema } from "#shared/hub/hub-contract.ts";
import {
  api,
  expectContainedInTiles,
  expectNoHorizontalOverflow,
  isPhone,
  openOverview,
  overviewTile as tile,
} from "./helpers.ts";

// Served by e2e/model-server.ts, where Arcade prod's newest request waits for
// approval beside the release it already accepted: the longest chip there is.

test("a chip with an accepted release and a request awaiting approval stays inside its tile", async ({
  page,
}) => {
  await page.goto("/");
  const chip = page
    .getByRole("main")
    .locator(".overview-tile")
    .filter({ has: page.getByRole("link", { name: "Arcade", exact: true }) })
    .getByRole("link", { name: /^prod / });
  await expect(chip).toContainText("awaiting approval");
  await expectContainedInTiles(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await expectContainedInTiles(page);
});

test("a phone says how many services are healthy, never a bare number", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const folds = page.getByRole("main").locator("details > summary");
  await expect(folds.first()).toBeVisible();
  for (const summary of await folds.all())
    await expect(summary).toHaveText(/^(?:All )?\d+ healthy$/u);
});

test("a long attention list collapses to five behind a Show all button, as on Pipelines", async ({
  page,
}) => {
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  const [first] = grid.attention;
  if (first === undefined)
    throw new Error("An attention item fixture is required");
  // Seven items whatever the seeded record holds.
  const attention = Array.from({ length: 7 }, (_, index) => ({
    ...first,
    title: `Fixture ${String(index + 1)} needs a look`,
    target: {
      kind: "deployment" as const,
      id: `fixture-${String(index + 1)}`,
    },
  }));
  await page.route("**/api/v1/hub/grid", (route) =>
    route.fulfill({ json: { ...grid, attention } }),
  );
  const region = await openOverview(page, "", { attention: "collapsed" });
  await expect(region).toContainText("7 items");
  await expect(region.getByRole("listitem")).toHaveCount(5);
  const toggle = region.getByRole("button", { name: "Show all 7" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(region.getByRole("listitem")).toHaveCount(7);
  await expect(
    region.getByRole("button", { name: "Show fewer" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expectNoHorizontalOverflow(page);
});

test("a queued worker retirement of the accepted release is not a pending release", async ({
  page,
}) => {
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  // Arcade prod accepted its release; Delivery's auto-retire asked to remove a
  // drained worker, which deploys the same release again.
  const groups = grid.groups.map((group) => ({
    ...group,
    services: group.services.map((service) =>
      service.id === "arcade"
        ? {
            ...service,
            environments: service.environments.map((environment) => ({
              ...environment,
              status: "succeeded" as const,
              request: null,
              alarmedAt: null,
              maintenance: {
                kind: "retire-host" as const,
                status: "queued" as const,
                deploymentId: "retire-fixture",
              },
            })),
          }
        : service,
    ),
  }));
  await page.route("**/api/v1/hub/grid", (route) =>
    route.fulfill({ json: { ...grid, groups } }),
  );
  await openOverview(page);
  const arcade = tile(page, "Arcade");
  if (isPhone(page) && !(await arcade.isVisible()))
    await page
      .getByRole("region", { name: "Products", exact: true })
      .locator("summary", { hasText: "healthy" })
      .click();
  const chip = arcade.getByRole("link", { name: /^prod / });
  await expect(chip).toHaveAccessibleName(
    /^prod .*r\d+ accepted .+ worker retirement queued$/u,
  );
  // The release is accepted, and nothing reads as a queued release.
  await expect(chip).not.toHaveAccessibleName(/r\d+ queued/u);
  await expect(chip.getByText("worker retirement queued")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectContainedInTiles(page);
});
