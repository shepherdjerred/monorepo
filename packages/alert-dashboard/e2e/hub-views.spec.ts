import { expect, test } from "@playwright/test";

import { DESKTOP, horizontalOverflow, PHONE, violations } from "./helpers.ts";

test("/renovate renders KPIs, charts, tabs, and LLM version-delta drawers", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/renovate");
  await expect(page).toHaveTitle("Renovate · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Renovate" }),
  ).toBeVisible();

  await expect(
    page.getByRole("meter", { name: "Open Renovate PRs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("meter", { name: "LLM Delta Coverage" }),
  ).toBeVisible();
  await expect(page.locator(".eng-kpi-card")).toHaveCount(5);
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Awaiting Approval" }),
  ).toContainText("18");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Merged (7d / 30d)" }),
  ).toContainText("29 / 114");
  await expect(page.locator(".chart-panel canvas")).toHaveCount(3);

  const openPrsTable = page.getByRole("table", {
    name: "Renovate updates (prs)",
  });
  await expect(openPrsTable).toContainText("hono");
  await expect(openPrsTable).toContainText("Running v4.12.18 → v4.13.2");

  await page.getByRole("tab", { name: /Pending Approval/u }).click();
  await expect(page).toHaveURL(/tab=approval/u);
  const approvalTable = page.getByRole("table", {
    name: "Renovate updates (approval)",
  });
  await expect(approvalTable).toContainText("prisma");
  await expect(approvalTable).toContainText("Running v7.10.0 → v8.0.0");
  await expect(approvalTable).toContainText("Breaking");

  await approvalTable
    .getByRole("button", { name: "Expand details for prisma" })
    .click();
  const drawer = approvalTable.locator(".eng-delta-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("v7.10.0");
  await expect(drawer).toContainText("v8.0.0");
  await expect(drawer).toContainText(
    "PrismaClient constructor requires an explicit driver adapter",
  );
  await expect(drawer).toContainText(
    "alert-dashboard and delivery already pass driver adapters; audit Json filter call sites.",
  );

  await page.getByRole("tab", { name: /Recent Merges/u }).click();
  await expect(page).toHaveURL(/tab=merged/u);
  await expect(
    page.getByRole("table", { name: "Recently merged Renovate pull requests" }),
  ).toContainText("#4805");
});

test("/product renders the 14-site PostHog table with sparklines, funnels, and charts", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/product");
  await expect(page).toHaveTitle("Product · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Product" }),
  ).toBeVisible();

  await expect(page.locator(".chart-panel canvas")).toHaveCount(4);
  await expect(
    page.getByRole("article", { name: "Scout Discord onboarding" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "The Storm player activation" }),
  ).toBeVisible();

  const sitesTable = page.getByRole("table", {
    name: "PostHog sites traffic and Core Web Vitals",
  });
  const rows = sitesTable.locator("tbody tr");
  await expect(rows).toHaveCount(14);
  await expect(sitesTable.locator("tbody svg.visual-sparkline")).toHaveCount(
    14,
  );
  await expect(sitesTable).toContainText("sjer.red");
  await expect(sitesTable).toContainText("scout.sjer.red");
});

test("/cluster renders Nodes, Workloads retained toggle, Databases, and Storage NVMe/ZFS tabs", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/cluster");
  await expect(page).toHaveTitle("Cluster · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Cluster" }),
  ).toBeVisible();

  await expect(page.getByRole("heading", { name: "torvalds" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "liskov" })).toBeVisible();
  await expect(page.locator(".chart-panel canvas")).toHaveCount(5);

  await page.getByRole("tab", { name: "Workloads" }).click();
  await expect(page).toHaveURL(/tab=workloads/u);
  await expect(page.locator(".platform-toolbar-meta")).toContainText(
    "Degraded workloads",
  );
  const workloadsTable = page.getByRole("table", {
    name: "Kubernetes workloads",
  });
  await expect(workloadsTable.locator("tbody tr")).toHaveCount(2);
  await expect(workloadsTable).not.toContainText("temporal-ops-worker-v42");

  const retainedToggle = page.getByRole("button", {
    name: /Include retained pools/u,
  });
  await expect(retainedToggle).toHaveAttribute("aria-pressed", "false");
  await retainedToggle.click();
  await expect(page).toHaveURL(/retained=1/u);
  await expect(retainedToggle).toHaveAttribute("aria-pressed", "true");
  await expect(workloadsTable.locator("tbody tr")).toHaveCount(3);
  await expect(workloadsTable).toContainText("temporal-ops-worker-v42");

  await page.getByRole("tab", { name: "Databases" }).click();
  await expect(page).toHaveURL(/tab=databases/u);
  const dbTable = page.getByRole("table", {
    name: "PostgreSQL and MariaDB clusters",
  });
  await expect(dbTable).toContainText("delivery-postgresql");
  await expect(dbTable).toContainText("postal-mariadb");

  await page.getByRole("tab", { name: "Storage, ZFS & NVMe" }).click();
  await expect(page).toHaveURL(/tab=storage/u);
  await expect(
    page.getByRole("heading", { name: "torvalds/nvme0n1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "liskov/nvme0n1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "ZFS pools by node" }),
  ).toContainText("torvalds/zfspv-pool-nvme");
});

test("/monorepo, /flow enrichment, and /the-storm render rich Hub 2.0 views", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/monorepo");
  await expect(page).toHaveTitle("Monorepo · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Monorepo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", {
      name: "Expensive and cache-missing Turborepo tasks",
    }),
  ).toContainText("@shepherdjerred/homelab#test");
  await expect(
    page.getByRole("table", { name: "Monorepo workspace packages" }),
  ).toContainText("@shepherdjerred/alert-dashboard");

  await page.goto("/flow");
  const enrichment = page.getByRole("region", {
    name: "Stacks and coordination",
  });
  await expect(enrichment).toBeVisible();
  await expect(enrichment).toContainText("git-spice PR stacks");
  await expect(enrichment).toContainText("FM-42");

  await page.goto("/the-storm");
  await expect(page).toHaveTitle("The Storm · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "The Storm" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Storm services" }).getByRole("listitem"),
  ).toHaveCount(3);
  await expect(page.getByText("ts-mc.net").first()).toBeVisible();
  await expect(page.locator(".chart-panel canvas")).toHaveCount(4);
});

test("deep /services/:id views render StatusMatrix, facet tables, and alias redirects", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);

  await page.goto("/services/cloudflare");
  await expect(page).toHaveURL(/\/services\/networking$/u);
  const cfMatrix = page.getByRole("table", {
    name: "Domain DNS, email & TLS baseline",
  });
  await expect(cfMatrix).toContainText("sjer.red");
  await expect(cfMatrix).toContainText("betterskillcapped.com");
  await expect(
    page.getByRole("table", { name: "Tailnet devices" }),
  ).toContainText("torvalds");
  await expect(
    page.getByRole("heading", { name: "What changed" }),
  ).toBeVisible();

  await page.goto("/services/flags");
  const fliptMatrix = page.getByRole("table", {
    name: "Flipt namespace sync status across prod and beta",
  });
  await expect(fliptMatrix).toContainText("Scout for LoL");
  await expect(
    page.getByRole("table", { name: "Managed feature flags inventory" }),
  ).toContainText("scout-experimental-voice-recap");
  // A service that is its own console links to it from the header.
  await expect(
    page.locator("main .page-head").getByRole("link", {
      name: "Open in Flags",
    }),
  ).toHaveAttribute("href", "https://flags.tailnet-1a49.ts.net");

  await page.goto("/services/golink");
  await expect(
    page.locator("main .page-head").getByRole("link", {
      name: "Open in Go links",
    }),
  ).toHaveAttribute("href", "https://go.tailnet-1a49.ts.net");

  await page.goto("/services/bugsink");
  await expect(
    page.getByRole("table", { name: "Bugsink projects error summary" }),
  ).toContainText("Scout for LoL");
  await expect(
    page.getByRole("table", { name: "Top unresolved Bugsink issues" }),
  ).toContainText("RiotUpstreamTimeoutError");
  await expect(page.getByRole("link", { name: /^Open in / })).toHaveCount(0);

  await page.goto("/services/observability");
  await expect(
    page.getByRole("meter", {
      name: "Prometheus TSDB WAL + blocks (200 GiB cap)",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Top cardinality metric names" }),
  ).toContainText("container_cpu_usage_seconds_total");
  await page.getByRole("tab", { name: "Tempo" }).click();
  await expect(
    page.getByRole("table", { name: "Service RED span metrics" }),
  ).toContainText("Scout for LoL");

  await page.goto("/services/temporal");
  await expect(
    page.getByRole("table", { name: "Temporal worker pools" }),
  ).toContainText("temporal-ops-worker");
  await expect(
    page.getByRole("table", { name: "Declarative schedules" }),
  ).toContainText("ops-snapshot");
});

const HUB_PATHS = [
  "/renovate?tab=approval&expand=renovate:prisma-8",
  "/product",
  "/cluster",
  "/cluster?tab=workloads&retained=1",
  "/cluster?tab=storage",
  "/monorepo",
  "/flow",
  "/the-storm",
  "/services/networking",
  "/services/flags",
  "/services/bugsink",
  "/services/observability",
  "/services/temporal",
] as const;

for (const viewport of [PHONE, DESKTOP]) {
  test(`Hub 2.0 pages fit ${String(viewport.width)}px without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const path of HUB_PATHS) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      const overflow = await horizontalOverflow(page);
      expect(overflow.document, path).toBeLessThanOrEqual(0);
      expect(overflow.main, path).toBeLessThanOrEqual(0);
    }
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Hub 2.0 pages have zero axe-core WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    for (const path of HUB_PATHS) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator(".loading-state")).toHaveCount(0);
      expect(await violations(page), path).toEqual([]);
    }
  });
}
