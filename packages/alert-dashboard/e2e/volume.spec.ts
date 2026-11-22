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
  /** Upper bounds on how far down the Trends charts start, in px. */
  readonly maxTrendsTop?: Record<ViewportName, number>;
};

/**
 * Height bounds are about 1.5x the heights measured with grouped, capped
 * lists (1.25x for /maintenance, whose uncapped height was only 4769 / 9339)
 * (per-update / aggregate, desktop then phone):
 *
 *   /             1835 / 1894   2997 / 3103
 *   /flow         2399 / 2632   4354 / 4586
 *   /maintenance  3543 / 2953   7363 / 6009
 *   /ai           2311 / 2311   4443 / 4443
 *
 * Before lists were capped, /flow (then /delivery) was 9284px at desktop
 * width on the same fixture (16295px on a phone). Home's lists were then on
 * /overview, which was 11842px (22908px on a phone), and 3221 / 2539
 * (6456 / 5956) once capped.
 *
 * The section pages put their summaries and charts above their signal lists,
 * so the Trends heading starts at 476 on /flow and 756 on /maintenance at
 * desktop width (725 and 1447 on a phone) in both variants; the bounds are
 * about 1.5x that. With the lists first it started at 1379 / 1551 on /flow
 * (2696 / 2928 on a phone) and at 2999 on /maintenance; before lists were
 * capped, at 8479 on /flow (14821 on a phone).
 *
 * /ai was 2991 at desktop width (4640 on a phone) while its quota windows
 * were a list of one tall row each beside a short spend panel.
 */
const PAGES: readonly PageBudget[] = [
  {
    path: "/",
    heading: "Home",
    maxHeight: { desktop: 2850, phone: 4700 },
  },
  {
    path: "/flow",
    heading: "Flow",
    maxHeight: { desktop: 3900, phone: 6800 },
    maxTrendsTop: { desktop: 720, phone: 1100 },
  },
  {
    path: "/maintenance",
    heading: "Maintenance",
    maxHeight: { desktop: 4400, phone: 9200 },
    maxTrendsTop: { desktop: 1150, phone: 2200 },
  },
  {
    path: "/ai",
    heading: "AI usage & spend",
    maxHeight: { desktop: 3500, phone: 6700 },
  },
];

/**
 * How far down Home its Areas grid may start at desktop width, so the grid
 * opens on the first screen. Measured 397 in both variants; on /overview the
 * same grid started at 2747 once lists were capped.
 */
const MAX_AREAS_TOP = 560;

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
          if (budget.maxTrendsTop !== undefined) {
            const trends = await page
              .getByRole("heading", { name: "Trends" })
              .boundingBox();
            expect(trends?.y).toBeLessThan(budget.maxTrendsTop[viewportName]);
          }
        });
      }
    });
  }
}

for (const variant of VARIANTS) {
  test(`${variant} Home shows where things are wrong on its first screen`, async ({
    page,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await serveVolume(page, variant);
    await page.goto("/");
    const areas = page.getByRole("region", { name: "Areas" });
    await expect(areas.locator(".section-card")).toHaveCount(9);
    const box = await areas.boundingBox();
    expect(box?.y).toBeLessThan(MAX_AREAS_TOP);
    // The count metric is `ok` in one variant and `error` in the other; a
    // critical alert fires in both, so the tile is an error in both.
    const firing = page
      .getByRole("list", { name: "At a glance" })
      .getByRole("listitem")
      .filter({ hasText: "Firing alerts" });
    await expect(firing).toHaveAttribute("data-sev", "error");
    await expect(firing).toContainText("Error");
  });
}

function attentionPanel(page: Page) {
  return page.getByRole("region", { name: "Needs attention" });
}

test("per-update: Renovate approvals collapse into one expandable row", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "per-update");
  await page.goto("/?show=waiting");
  const waiting = attentionPanel(page);
  const filter = waiting.getByRole("radio", { name: /^Waiting on you/u });
  await expect(filter).toHaveAttribute("aria-checked", "true");
  await expect(filter).toContainText("123");

  // 123 signals are 24 entries, and the list shows the eight worst.
  const entries = waiting.locator(".signal-list").first().locator("> li");
  await expect(entries).toHaveCount(8);
  const showAll = waiting.getByRole("button", { name: "Show 16 more" });
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
  await expect(entries).toHaveCount(8);
  await expect(
    waiting.getByRole("button", { name: "Show 16 more" }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("aggregate: failed restores lead the list as one row", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.phone);
  await serveVolume(page, "aggregate");
  await page.goto("/?show=waiting");
  const waiting = attentionPanel(page);
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

function quotaTable(page: Page) {
  return page.getByRole("table", { name: /^Subscription quota/u });
}

function quotaRow(page: Page, meterName: string) {
  return quotaTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("meter", { name: meterName }) });
}

test("aggregate: a quota window that has reset is informational, not an error", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "aggregate");
  await page.goto("/ai");
  await expect(quotaTable(page).locator("tbody")).toHaveCount(7);
  await expect(quotaTable(page).getByRole("meter")).toHaveCount(14);

  // Its last reading was 100%, and its reset time has passed.
  const reset = quotaRow(page, "Claude Code 5-hour quota used");
  await expect(reset).toContainText("reset · was 100%");
  await expect(reset).toContainText("awaiting new reading");
  await expect(reset).toHaveAttribute("data-sev", "info");
  await expect(reset).not.toHaveAttribute("data-sev", "error");
  await expect(reset).toContainText("Info");
  const meter = reset.getByRole("meter");
  await expect(meter).toHaveAttribute("data-reset", "");
  await expect(meter).not.toHaveAttribute("data-sev", "error");
  await expect(meter).toHaveAttribute("aria-valuetext", "reset · was 100%");

  // 91% used but resetting within the hour or so: capped, and still live.
  const soon = quotaRow(page, "Antigravity Claude 5h quota used");
  await expect(soon).toHaveAttribute("data-sev", "info");
  await expect(soon).not.toHaveAttribute("data-reset");
  await expect(soon).toContainText("91%");
  await expect(soon).toContainText("resets in 1h");
  await expect(soon.getByRole("meter")).toHaveAttribute("data-sev", "info");

  // 97% with days to go is an error in both variants.
  const full = quotaRow(page, "Claude Code Weekly Opus quota used");
  await expect(full).toHaveAttribute("data-sev", "error");
  await expect(full).toContainText("Error");
});

test("per-update: a reset quota window keeps the severity the collector reports", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "per-update");
  await page.goto("/ai");
  // Today's collector still calls the window an error; the page does not
  // overrule it, though its reset time shows the reading is the last one.
  const reset = quotaRow(page, "Claude Code 5-hour quota used");
  await expect(reset).toHaveAttribute("data-sev", "error");
  await expect(reset).toContainText("Error");
  await expect(reset).toContainText("reset · was 100%");
  await expect(reset.getByRole("meter")).toHaveAttribute("data-sev", "error");
  const soon = quotaRow(page, "Antigravity Claude 5h quota used");
  await expect(soon).toHaveAttribute("data-sev", "warning");
  await expect(soon).toContainText("91%");
});

test("the AI page ranks tools by API-equivalent spend with a total", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "aggregate");
  await page.goto("/ai");
  const tools = page.getByRole("table", { name: "Usage by tool" });
  await expect(tools.locator("tbody th")).toHaveText([
    "Claude",
    "Codex",
    "Antigravity",
    "Cursor",
    "Kimi",
  ]);
  await expect(tools.locator("tfoot td")).toHaveText("$690.01");
  // What is left is the budget and provider-billed signals, in one list.
  const other = page.getByRole("region", { name: /^Other signals/u });
  await expect(other.locator(".signal")).toHaveCount(2);
});

test("alerts are never collapsed", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.desktop);
  await serveVolume(page, "per-update");
  await page.goto("/");
  const attention = attentionPanel(page);
  await expect(attention.getByRole("radio", { name: /^All/u })).toContainText(
    "143",
  );
  // 143 signals are 44 entries: the 100 approvals are one row, and each of
  // the other 43 signals, every alert among them, keeps a row of its own.
  await attention.getByRole("button", { name: "Show 36 more" }).click();
  await expect(attention.locator(".signal")).toHaveCount(43);
  const groups = attention.locator(".signal-group");
  await expect(groups).toHaveCount(1);
  await expect(groups.locator("summary")).toContainText(
    "100 Renovate updates awaiting approval",
  );
  for (const title of [
    "torvalds has under 5% memory available",
    "Scout Riot API error rate is above 5%",
    "PVC media/plex-config is 87% full",
  ])
    await expect(attention.locator(".signal", { hasText: title })).toHaveCount(
      1,
    );
});
