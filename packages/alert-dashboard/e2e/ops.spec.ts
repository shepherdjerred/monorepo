import { expect, test, type Locator } from "@playwright/test";

import { DigestReportSchema } from "#shared/ops-schema";

/** How far down the page an element starts, in px. */
async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("the element is not rendered");
  return box.y;
}

test("home answers what is wrong, where, and what waits on me", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Home · Hub");
  const banner = page.getByRole("region", { name: "Overall status" });
  await expect(banner).toContainText("7 areas need attention");
  await expect(banner).toContainText("Error");

  const glance = page.getByRole("list", { name: "At a glance" });
  const firing = glance.getByRole("link", { name: /Firing alerts/u });
  await expect(firing).toContainText("3");
  await expect(firing).toContainText("in 1 group · 1 critical");
  await expect(firing).toHaveAttribute("href", "/alerts");
  // Severity is a badge with a word, not only the tile's border colour.
  await expect(firing).toContainText("Error");
  const waitingTile = glance.getByRole("link", { name: /Waiting on you/u });
  await expect(waitingTile).toContainText("4");
  await expect(waitingTile).toHaveAttribute("href", "/?show=waiting");
  const triage = glance.getByRole("link", { name: /Tracker triage/u });
  await expect(triage).toContainText("2");
  await expect(triage).toHaveAttribute(
    "href",
    "https://tracker.tailnet-1a49.ts.net",
  );

  await expect(
    page.getByRole("region", { name: "Areas" }).locator(".section-card"),
  ).toHaveCount(9);

  const attention = page.getByRole("region", { name: "Needs attention" });
  const all = attention.getByRole("radio", { name: /^All/u });
  const waiting = attention.getByRole("radio", { name: /^Waiting on you/u });
  await expect(all).toHaveAttribute("aria-checked", "true");
  await expect(waiting).toContainText("4");
  await expect(attention.locator(".signal").first()).toContainText(
    "Velero backup is 41 hours old",
  );
  await waiting.click();
  await expect(waiting).toHaveAttribute("aria-checked", "true");
  await expect(attention.locator(".signal")).toHaveCount(4);
  await expect(page).toHaveURL(/\/\?show=waiting$/u);
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/\/$/u);
});

test("the waiting tile filters the attention panel and brings it into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  const attention = page.getByRole("region", { name: "Needs attention" });
  const heading = attention.getByRole("heading", { name: "Needs attention" });
  await expect(heading).not.toBeInViewport();
  await page
    .getByRole("list", { name: "At a glance" })
    .getByRole("link", { name: /Waiting on you/u })
    .click();
  await expect(page).toHaveURL(/\/\?show=waiting$/u);
  await expect(
    attention.getByRole("radio", { name: /^Waiting on you/u }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(attention.locator(".signal")).toHaveCount(4);
  await expect(heading).toBeInViewport();
});

test("home lists what is new since the last visit and marks all seen", async ({
  page,
}) => {
  await page.goto("/");
  const fresh = page.getByRole("region", { name: /New since last visit/u });
  await expect(fresh.locator(".signal").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark all seen" }).click();
  await expect(fresh).toContainText("Nothing new since you last marked");
  await page.reload();
  await expect(fresh).toContainText("Nothing new since you last marked");
});

test("home launches the other apps and the tools", async ({ page }) => {
  await page.goto("/");
  const launcher = page.locator("section", {
    has: page.getByRole("heading", { name: "Launcher" }),
  });
  // The app's own pages are in the sidebar, not repeated here.
  await expect(launcher.getByRole("list")).toHaveCount(2);
  await expect(
    launcher.getByRole("list", { name: "Apps" }).getByRole("link", {
      name: "Delivery",
    }),
  ).toHaveAttribute("href", "https://delivery.tailnet-1a49.ts.net");
  await expect(
    launcher.getByRole("list", { name: "Tools" }).getByRole("link", {
      name: "Grafana",
    }),
  ).toHaveAttribute("href", "https://grafana.tailnet-1a49.ts.net");

  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Flow" })
    .click();
  await expect(page).toHaveURL(/\/flow$/u);
  await expect(page).toHaveTitle("Flow · Hub");
  await expect(page.locator("main h1")).toHaveText("Flow");
});

test("/delivery redirects to /flow and keeps the query string and fragment", async ({
  page,
}) => {
  await page.goto("/delivery");
  await expect(page).toHaveURL(/\/flow$/u);
  await expect(page).toHaveTitle("Flow · Hub");
  await expect(page.locator("main h1")).toHaveText("Flow");

  await page.goto("/delivery?range=30d#signals-work");
  await expect(page).toHaveURL(/\/flow\?range=30d#signals-work$/u);
  await expect(page.getByRole("radio", { name: "30d" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("a section page leads with summaries, then trends, then the signals", async ({
  page,
}) => {
  await page.goto("/maintenance");
  await expect(page).toHaveTitle("Maintenance · Hub");
  const summaries = page
    .getByRole("region", { name: "Summary" })
    .getByRole("article");
  await expect(summaries).toHaveCount(4);
  const maintenance = summaries.filter({
    has: page.getByRole("heading", { name: "Maintenance" }),
  });
  await expect(maintenance).toContainText("Error");
  // Every metric is on the card, not only the first three.
  await expect(maintenance.locator(".metric")).toHaveCount(3);
  await expect(
    summaries
      .filter({ has: page.getByRole("heading", { name: "Cluster & GitOps" }) })
      .locator(".metric"),
  ).toHaveCount(4);

  // A metric that needs attention says so in words, not only with its bar.
  const stale = maintenance.locator(".metric", { hasText: "Stale backups" });
  await expect(stale).toHaveClass(/\bmetric-error\b/u);
  await expect(stale).toContainText("error");
  const disk = maintenance.locator(".metric", { hasText: "Max disk used" });
  await expect(disk).toHaveClass(/\bmetric-ok\b/u);
  await expect(disk).toHaveText("Max disk used71%");

  // One panel per section, each with its count, below the charts.
  const signals = page.getByRole("heading", { level: 2, name: "Signals" });
  const trends = page.getByRole("heading", { level: 2, name: "Trends" });
  expect(await top(trends)).toBeGreaterThan(await top(summaries.last()));
  expect(await top(signals)).toBeGreaterThan(await top(trends));
  const panels = page.locator(".signal-columns .panel");
  await expect(panels).toHaveCount(4);
  const backups = page.getByRole("region", { name: /^Maintenance/u });
  await expect(backups.getByRole("heading", { level: 3 })).toHaveText(
    /^Maintenance\s*\d+$/u,
  );
  await expect(backups.locator(".signal").first()).toBeVisible();
  expect(await top(panels.first())).toBeGreaterThan(await top(signals));
});

test("a chart's legend shows the latest values until a point is hovered", async ({
  page,
}) => {
  await page.goto("/flow");
  const chart = page.locator("figure", {
    has: page.getByRole("heading", { name: "Open pull requests" }),
  });
  const legend = chart.locator(".u-legend");
  await expect(chart.locator("canvas")).toBeVisible();
  // At rest: a time and a value for each series, never uPlot's `--`.
  await expect(legend).not.toContainText("--");
  await expect(legend.locator(".u-series")).toHaveCount(3);
  for (const value of await legend.locator(".u-value").allTextContents())
    expect(value).toMatch(/\d/u);
  const atRest = await legend.innerText();

  const plot = chart.locator(".u-over");
  const box = await plot.boundingBox();
  if (box === null) throw new Error("the chart has no plot area");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await expect(legend).not.toHaveText(atRest);
  await expect(legend).not.toContainText("--");

  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await expect(legend).toHaveText(atRest);
});

test("review leads with its verdict, then numbers, charts and lists", async ({
  page,
}) => {
  await page.goto("/review");
  await expect(page).toHaveTitle("Review · Hub");
  const banner = page.getByRole("region", { name: "Status" });
  await expect(banner).toContainText("7 areas need attention");
  await expect(banner).toContainText("Error");
  await expect(
    page.getByRole("region", { name: "Compared with the previous week" }),
  ).toBeVisible();
  const incidents = page.getByRole("region", { name: "Incidents" });
  await expect(incidents.locator(".metric")).toHaveCount(3);
  const changes = page.getByRole("region", { name: "Changes" });
  await expect(changes.locator(".change").first()).toBeVisible();

  // Banner, numbers, charts, then the lists.
  const tops = await Promise.all(
    [
      banner,
      incidents,
      page.getByRole("heading", { level: 2, name: "Trends" }),
      page.getByRole("region", { name: /^New this period/u }),
    ].map((locator) => top(locator)),
  );
  expect(tops).toEqual(tops.toSorted((left, right) => left - right));

  await page.getByRole("radio", { name: "Day" }).click();
  await expect(page).toHaveURL(/kind=daily/u);
  await expect(
    page.getByRole("region", { name: /^New since the last digest/u }),
  ).toBeVisible();
  // The daily review has no week-over-week table.
  await expect(
    page.getByRole("region", { name: "Compared with the previous week" }),
  ).toHaveCount(0);
});

test("/overview redirects to / and keeps the query string", async ({
  page,
}) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/$/u);
  await expect(page).toHaveTitle("Home · Hub");
  await expect(page.locator("main h1")).toHaveText("Home");

  await page.goto("/overview?show=waiting");
  await expect(page).toHaveURL(/\/\?show=waiting$/u);
  await expect(
    page
      .getByRole("region", { name: "Needs attention" })
      .getByRole("radio", { name: /^Waiting on you/u }),
  ).toHaveAttribute("aria-checked", "true");
});

test("review draws its charts while the report is still loading", async ({
  page,
}) => {
  const held = Promise.withResolvers<null>();
  await page.route("**/api/v1/ops/review*", async (route) => {
    await held.promise;
    await route.continue();
  });
  await page.goto("/review");
  const charts = page.locator(".chart-panel canvas");
  await expect(charts).toHaveCount(4);
  await expect(page.getByText("Loading review…")).toBeVisible();
  const trends = page.getByRole("heading", { level: 2, name: "Trends" });
  const before = await top(trends);

  held.resolve(null);
  await expect(page.getByRole("region", { name: "Status" })).toBeVisible();
  await expect(charts).toHaveCount(4);
  // The top block held its place, so the charts barely moved.
  expect(Math.abs((await top(trends)) - before)).toBeLessThan(60);
});

test("a long change timeline shows fifteen changes until it is expanded", async ({
  page,
}) => {
  await page.route("**/api/v1/ops/review*", async (route) => {
    const response = await route.fetch();
    const report = DigestReportSchema.parse(await response.json());
    const [first] = report.changes;
    if (first === undefined) throw new Error("the fixture has no changes");
    await route.fulfill({
      response,
      json: {
        ...report,
        changes: Array.from({ length: 40 }, (_, index) => ({
          ...first,
          id: `change-${String(index)}`,
          title: `Change ${String(index + 1)}`,
        })),
      },
    });
  });
  await page.goto("/review");
  const changes = page.getByRole("region", { name: "Changes" });
  const rows = changes.locator(".change");
  await expect(rows).toHaveCount(15);
  await expect(rows.last()).toContainText("Change 15");
  const more = changes.getByRole("button", { name: "Show 25 more" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(changes.getByRole("list")).toHaveAttribute(
    "id",
    (await more.getAttribute("aria-controls")) ?? "missing",
  );
  await more.click();
  await expect(rows).toHaveCount(40);
  await changes.getByRole("button", { name: "Show fewer" }).click();
  await expect(rows).toHaveCount(15);
});

test("service detail joins signals, the change timeline, and drill-down links", async ({
  page,
}) => {
  await page.goto("/services/scout-for-lol");
  await expect(page).toHaveTitle("scout-for-lol · Hub");
  await expect(
    page.getByRole("heading", { name: "Scout for LoL", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("scout-beta is OutOfSync")).toBeVisible();
  const timeline = page.locator("section", {
    has: page.getByRole("heading", { name: "What changed" }),
  });
  await expect(timeline).toContainText("scout-beta synced to 8f3c2d1");
  await expect(timeline).toContainText(
    "Resolved: scout-beta worker restarted repeatedly",
  );
  const logs = page.getByRole("link", { name: "Logs" });
  await expect(logs).toHaveAttribute(
    "href",
    /^https:\/\/grafana\.tailnet-1a49\.ts\.net\/explore\?/u,
  );
  await page.goto("/services/not-a-service");
  await expect(page.getByText("No service")).toBeVisible();
});

test("AI page shows quota windows, spend against budget, and charts", async ({
  page,
}) => {
  await page.goto("/ai?range=24h");
  await expect(page).toHaveTitle("AI · Hub");
  await expect(page.getByRole("meter")).toHaveCount(5);
  await expect(
    page.getByRole("meter", { name: "claude 7d quota used" }),
  ).toHaveAttribute("aria-valuenow", "84");
  await expect(page.getByText("$86.40")).toBeVisible();
  await expect(page.getByText(/Projected month end \$112\.10/u)).toBeVisible();
  const costChart = page.locator("figure", {
    has: page.getByRole("heading", { name: "AI cost by source" }),
  });
  await expect(costChart.locator("canvas")).toBeVisible();
  await expect(costChart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /claude-code/u,
  );
  await page.getByRole("radio", { name: "7d" }).click();
  await expect(page).toHaveURL(/range=7d/u);
});

test("the ops layout fits a phone without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [
    "/",
    "/flow",
    "/maintenance",
    "/services/scout-for-lol",
    "/ai",
    "/review",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
