import { expect, test } from "@playwright/test";
import { expectContainedInTiles } from "./helpers.ts";

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
