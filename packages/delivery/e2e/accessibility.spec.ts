import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { DeploymentSchema } from "#shared/contract.ts";
import { api } from "./helpers.ts";

const PAGES = [
  "/pipelines",
  "/pipelines/scout-for-lol",
  "/pipelines/arcade/executions",
  "/environments/scout-for-lol/prod",
  "/environments/gitops/root",
  "/deployments",
  "/approvals",
  "/artifacts",
  "/activity",
];

for (const scheme of ["light", "dark"] as const) {
  test(`pages meet WCAG 2.2 AA in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const approvals = await api(
      page,
      "/api/v1/approvals",
      z.array(DeploymentSchema),
    );
    const extra = approvals
      .slice(0, 1)
      .map((deployment) => `/deployments/${deployment.id}`);
    for (const path of [...PAGES, ...extra]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.locator("[role=status]", { hasText: "Loading" }),
      ).toHaveCount(0);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((violation) => ({
          path,
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target.join(" ")),
        })),
      ).toEqual([]);
    }
  });
}

test("reduced motion stops animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pipelines/arcade");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.document.getAnimations().length),
  ).toBe(0);
});
