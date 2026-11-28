import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./review-setup.ts";
import type { SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

test.describe("accessibility", () => {
  const routes: readonly (readonly [string, () => string])[] = [
    ["inbox", () => "/"],
    ["board", () => "/b/demo"],
    ["outline", () => "/b/demo/outline"],
    ["html", () => `/a/${seeded.demo.htmlV2.artifactId}`],
    ["pdf", () => `/a/${seeded.demo.pdf.artifactId}`],
    ["video", () => `/a/${seeded.demo.mp4.artifactId}`],
    ["markdown", () => `/a/${seeded.demo.markdown.artifactId}`],
    ["image", () => `/a/${seeded.demo.png.artifactId}`],
    ["cast", () => `/a/${seeded.demo.cast.artifactId}`],
    ["file", () => `/a/${seeded.demo.bin.artifactId}`],
  ];
  for (const [name, route] of routes) {
    test(`${name} has no axe violations`, async ({ page }) => {
      const { default: AxeBuilder } = await import("@axe-core/playwright");
      await page.goto(route());
      await expect(page.getByRole("main")).toBeVisible();
      await page.waitForTimeout(1500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  }
});
