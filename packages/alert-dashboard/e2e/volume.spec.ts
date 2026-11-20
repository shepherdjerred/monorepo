import { Temporal } from "@js-temporal/polyfill";
import { expect, test, type Page } from "@playwright/test";

import {
  volumeSnapshotResponse,
  type VolumeVariant,
} from "#test-fixtures/ops-snapshot-volume";

/**
 * Regression guard for page length at production volume. The web server
 * serves the small fixture, so each test fulfils the snapshot request with
 * the volume fixture instead, with every signal marked new so the "New since
 * last visit" list is as long as it can be.
 */
const VARIANTS: readonly VolumeVariant[] = ["per-update", "aggregate"];

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 375, height: 812 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;

type PageBudget = {
  readonly path: string;
  readonly heading: string;
  /** Upper bounds on `scrollHeight`, in px. */
  readonly maxHeight: Record<ViewportName, number>;
};

/**
 * Bounds are about 1.5x the heights measured with grouped, capped lists
 * (1.25x for /maintenance, whose uncapped height was only 4769 / 9339)
 * (per-update / aggregate, desktop then phone):
 *
 *   /overview     3221 / 2539   6456 / 5956
 *   /delivery     2184 / 2355   4170 / 4402
 *   /maintenance  3415 / 2660   7110 / 5757
 *   /ai           3009 / 3009   4606 / 4606
 *
 * Before lists were capped, /overview was 11842px and /delivery 9284px at
 * desktop width on the same fixture (22908px and 16295px on a phone).
 */
const PAGES: readonly PageBudget[] = [
  {
    path: "/overview",
    heading: "Overview",
    maxHeight: { desktop: 4800, phone: 9700 },
  },
  {
    path: "/delivery",
    heading: "Delivery",
    maxHeight: { desktop: 3500, phone: 6600 },
  },
  {
    path: "/maintenance",
    heading: "Maintenance",
    maxHeight: { desktop: 4300, phone: 8900 },
  },
  {
    path: "/ai",
    heading: "AI usage & spend",
    maxHeight: { desktop: 4500, phone: 6900 },
  },
];

/**
 * How far down /delivery its Trends charts may start. Measured 1379 / 1551
 * at desktop width and 2696 / 2928 on a phone; it was 8479 and 14821.
 */
const MAX_TRENDS_TOP: Record<ViewportName, number> = {
  desktop: 2300,
  phone: 4400,
};

async function serveVolume(page: Page, variant: VolumeVariant): Promise<void> {
  const snapshot = volumeSnapshotResponse(
    Temporal.Now.instant().toString(),
    variant,
  );
  const body = JSON.stringify({
    ...snapshot,
    newSignalIds: snapshot.sections.flatMap((section) =>
      section.signals.map((signal) => signal.id),
    ),
  });
  await page.route("**/api/v1/ops/snapshot*", (route) =>
    route.fulfill({ contentType: "application/json", body }),
  );
}

async function open(page: Page, budget: PageBudget): Promise<void> {
  await page.goto(budget.path);
  await expect(
    page.getByRole("heading", { level: 1, name: budget.heading }),
  ).toBeVisible();
  await expect(page.locator(".signal").first()).toBeVisible();
  // Charts fetch their series after the snapshot; measure the settled page.
  await page.waitForLoadState("networkidle");
}

function documentSize(page: Page): Promise<{
  scrollHeight: number;
  scrollWidth: number;
  clientWidth: number;
}> {
  return page.evaluate(() => ({
    scrollHeight: globalThis.document.documentElement.scrollHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
}

for (const variant of VARIANTS) {
  for (const viewportName of ["desktop", "phone"] as const) {
    test(`${variant} pages stay short at ${viewportName} width`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORTS[viewportName]);
      await serveVolume(page, variant);
      for (const budget of PAGES) {
        await test.step(budget.path, async () => {
          await open(page, budget);
          const size = await documentSize(page);
          expect(size.scrollHeight).toBeLessThan(
            budget.maxHeight[viewportName],
          );
          expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
          if (budget.path === "/delivery") {
            const trends = await page
              .getByRole("heading", { name: "Trends" })
              .boundingBox();
            expect(trends?.y).toBeLessThan(MAX_TRENDS_TOP[viewportName]);
          }
        });
      }
    });
  }
}

function waitingOnYou(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: /Waiting on you/u }),
  });
}

test("per-update: Renovate approvals collapse into one expandable row", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "per-update");
  await page.goto("/overview");
  const waiting = waitingOnYou(page);
  await expect(
    waiting.getByRole("heading", { name: /Waiting on you/u }),
  ).toContainText("123");

  // 123 signals are 24 entries, and the list shows the ten worst.
  const entries = waiting.locator(".signal-list").first().locator("> li");
  await expect(entries).toHaveCount(10);
  const showAll = waiting.getByRole("button", { name: "Show 14 more" });
  await expect(showAll).toHaveAttribute("aria-expanded", "false");
  await showAll.click();
  await expect(entries).toHaveCount(24);
  const showFewer = waiting.getByRole("button", { name: "Show fewer" });
  await expect(showFewer).toHaveAttribute("aria-expanded", "true");
  // The button names the list it controls.
  await expect(entries.first().locator("xpath=..")).toHaveAttribute(
    "id",
    (await showFewer.getAttribute("aria-controls")) ?? "missing",
  );

  // The approvals are informational, so their row ranks below the warnings.
  const group = waiting.locator(".signal-group");
  await expect(group).toHaveCount(1);
  const summary = group.locator("summary");
  await expect(summary).toContainText("100 Renovate updates awaiting approval");
  await expect(summary).toContainText("Info");
  await expect(summary).toContainText("100 new");
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(group.locator(".signal")).toHaveCount(0);

  // The disclosure is keyboard operable and mounts its members on open.
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(group.locator("details")).toHaveAttribute("open", "");
  await expect(group.locator(".signal")).toHaveCount(25);
  await expect(group.locator(".signal").first()).toContainText(
    "chore(deps): update dependency",
  );
  await group.getByRole("button", { name: "Show 75 more" }).click();
  await expect(group.locator(".signal")).toHaveCount(100);
  await group.getByRole("button", { name: "Show fewer" }).click();
  await expect(group.locator(".signal")).toHaveCount(25);
  await summary.click();
  await expect(group.locator(".signal")).toHaveCount(0);

  await showFewer.click();
  await expect(entries).toHaveCount(10);
  await expect(
    waiting.getByRole("button", { name: "Show 14 more" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("aggregate: failed restores lead the list as one row", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await serveVolume(page, "aggregate");
  await page.goto("/overview");
  const waiting = waitingOnYou(page);
  const first = waiting.locator(".signal-list").first().locator("> li").first();
  await expect(first).toHaveClass("signal-group");
  await expect(first.locator("summary")).toContainText(
    "10 failed Velero restores",
  );
  await expect(first.locator("summary")).toContainText("Warning");
  await expect(first.locator("summary")).toContainText(/oldest \d+d ago/u);
  await first.locator("summary").click();
  // Ten members is under the group's own cap, so there is no second toggle.
  await expect(first.locator(".signal")).toHaveCount(10);
  await expect(first.getByRole("button")).toHaveCount(0);
  const size = await documentSize(page);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
});

test("alerts are never collapsed", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "per-update");
  await page.goto("/overview");
  const attention = page.locator("section", {
    has: page.getByRole("heading", { name: /Needs attention/u }),
  });
  await attention.getByRole("button", { name: "Show 29 more" }).click();
  await expect(attention.locator(".signal")).toHaveCount(39);
  await expect(attention.locator(".signal-group")).toHaveCount(0);
});
