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
      await page
        .getByRole("combobox", { name: "Search issues and commands" })
        .fill("worker");
      await expect(
        page.getByRole("option", { name: /Investigate worker restart/u }),
      ).toBeVisible();
    },
  },
  {
    name: "an open status picker on a row",
    open: async (page) => {
      await page.goto("/issues");
      await page.locator('[data-picker="state"]').first().click();
      await expect(
        page.getByRole("option", { name: "Backlog" }).first(),
      ).toBeVisible();
    },
  },
  {
    name: "the assignee picker",
    open: async (page) => {
      await page.goto("/issues");
      await page.locator('[data-picker="assignee"]').first().click();
      await expect(
        page.getByRole("option", { name: /Assign to me/u }),
      ).toBeVisible();
    },
  },
  {
    name: "the issue context menu",
    open: async (page) => {
      await page.goto("/issues");
      await page
        .locator("a[data-issue-row]")
        .first()
        .click({ button: "right" });
      // An open submenu is left out: Base UI owns its portal through a
      // span[aria-owns] inside the menu, which axe reports as a child the
      // menu role does not allow.
      await expect(
        page.getByRole("menuitem", { name: "Copy ID" }),
      ).toBeVisible();
    },
  },
  {
    name: "the bulk bar",
    open: async (page) => {
      await page.goto("/issues");
      for (const index of [0, 1]) {
        await page
          .locator("a[data-issue-row]")
          .nth(index)
          .click({ button: "right" });
        await page.getByRole("menuitem", { name: "Select" }).click();
      }
      await expect(
        page.getByRole("region", { name: "Selected issues" }),
      ).toContainText("2 selected");
    },
  },
  {
    name: "the filter popover and chips",
    open: async (page) => {
      await page.goto("/issues?state=Todo&label=feature");
      await page.getByRole("button", { name: /^Filter/u }).click();
      await page.getByRole("option", { name: "Status" }).click();
      await expect(page.getByRole("option", { name: "Todo" })).toBeVisible();
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
