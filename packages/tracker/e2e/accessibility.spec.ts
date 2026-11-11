import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const surfaces: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "issue list",
    open: async (page) => {
      await page.goto("/issues");
      await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
    },
  },
  {
    name: "board",
    open: async (page) => {
      await page.goto("/board");
      await expect(page.locator(".board-card").first()).toBeVisible();
    },
  },
  {
    name: "issue detail",
    open: async (page) => {
      await page.goto("/issues/AI-1");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Acceptance", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "issue detail with a toast",
    open: async (page) => {
      await page.goto("/issues/AI-1");
      await page.locator("#property-priority").selectOption("Low");
      await expect(page.locator(".toast")).toContainText("priority set to Low");
      await expect(
        page.getByRole("heading", { name: "Acceptance", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "command palette",
    open: async (page) => {
      await page.goto("/issues");
      await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox").fill("worker");
      await expect(
        page.getByRole("option", { name: /Investigate worker restart/u }),
      ).toBeVisible();
    },
  },
  {
    name: "settings",
    open: async (page) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Appearance", exact: true }),
      ).toBeVisible();
    },
  },
];

for (const colorScheme of ["light", "dark"] as const) {
  for (const surface of surfaces) {
    test(`${surface.name} has no serious accessibility violations in ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await surface.open(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter(({ impact }) => impact === "serious" || impact === "critical")
        .map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map(({ target }) => target.join(" ")),
        }));
      expect(blocking).toEqual([]);
    });
  }
}
