import {
  ClusterFacetSchema,
  type ClusterFacet,
} from "@shepherdjerred/ops-model/facets.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { OpsFacetResponse, ServiceDetail } from "#shared/ops-schema";
import { InstantTextSchema } from "#shared/time";
import { FIXTURE_OPS_FACETS } from "#test-fixtures/ops-facets";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";

vi.mock("#client/theme.ts", () => ({
  useResolvedTheme: () => "light",
}));

const {
  ClusterPage,
  filterClusterWorkloads,
  isWorkloadDegraded,
  sortClusterWorkloads,
} = await import("./cluster-page.tsx");
const { opsKeys } = await import("#client/ops/ops-api.ts");
const { renderPlatformServiceView, UniversalServiceTelemetry } =
  await import("#client/ops/service-views/platform-views.tsx");
const { ServicesPage } = await import("#client/ops/services-page.tsx");

const GENERATED_AT = InstantTextSchema.parse("2026-11-21T22:30:00Z");
const RECEIVED_AT = InstantTextSchema.parse("2026-11-21T22:30:05Z");

function buildClusterFixture(): ClusterFacet {
  const base = ClusterFacetSchema.parse(FIXTURE_OPS_FACETS.cluster);
  return {
    ...base,
    workloadSummary: {
      total: 5,
      healthy: 3,
      degraded: 2,
      retainedPools: 1,
    },
    workloads: [
      {
        namespace: "arcade",
        kind: "Deployment",
        name: "arcade-web",
        readyReplicas: 2,
        desiredReplicas: 2,
        restarts24h: 0,
        oomKills24h: 0,
        image: "docker.io/shepherdjerred/arcade@sha256:1111111",
        serviceId: "arcade",
        argoApp: "arcade",
        retainedPool: false,
      },
      {
        namespace: "birmel",
        kind: "Deployment",
        name: "birmel-bot",
        readyReplicas: 1,
        desiredReplicas: 1,
        restarts24h: 4,
        oomKills24h: 0,
        image: "docker.io/shepherdjerred/birmel@sha256:2222222",
        serviceId: "birmel",
        argoApp: "birmel",
        retainedPool: false,
      },
      {
        namespace: "scout-prod",
        kind: "Deployment",
        name: "scout-worker",
        readyReplicas: 0,
        desiredReplicas: 2,
        restarts24h: 3,
        oomKills24h: 1,
        image: "docker.io/shepherdjerred/scout-for-lol@sha256:3333333",
        serviceId: "scout-for-lol",
        argoApp: "scout-prod",
        retainedPool: false,
      },
      {
        namespace: "temporal",
        kind: "Deployment",
        name: "temporal-ops-worker-v42",
        readyReplicas: 1,
        desiredReplicas: 1,
        restarts24h: 0,
        oomKills24h: 0,
        image: "docker.io/shepherdjerred/temporal-worker@sha256:4444444",
        serviceId: "temporal",
        argoApp: "temporal",
        retainedPool: true,
      },
    ],
    zpools: [
      ...base.zpools,
      {
        node: "torvalds",
        pool: "zfspv-pool-hdd",
        usedBytes: 8_400_000_000_000,
        sizeBytes: 16_000_000_000_000,
        freeBytes: 7_600_000_000_000,
        fragmentationPercent: 9,
        health: "ONLINE",
      },
    ],
  };
}

function createPopulatedClient(cluster: ClusterFacet): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const envelope: OpsFacetResponse<"cluster"> = {
    key: "cluster",
    generatedAt: GENERATED_AT,
    receivedAt: RECEIVED_AT,
    stale: false,
    data: cluster,
  };
  client.setQueryData(opsKeys.facet("cluster"), envelope);
  client.setQueryData(opsKeys.facets(), {
    generatedAt: GENERATED_AT,
    receivedAt: RECEIVED_AT,
    stale: false,
    facets: { ...FIXTURE_OPS_FACETS, cluster },
  });
  for (const key of [
    "cloudflare",
    "tailscale",
    "observability",
    "temporal",
    "bugsink",
  ] as const) {
    client.setQueryData(opsKeys.facet(key), {
      key,
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: FIXTURE_OPS_FACETS[key] ?? null,
    });
  }
  return client;
}

function renderClusterAt(
  entry: string,
  cluster: ClusterFacet = buildClusterFixture(),
): string {
  const client = createPopulatedClient(cluster);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: [entry] },
        createElement(ClusterPage),
      ),
    ),
  );
}

describe("ClusterPage workload sorting and retained-pool filtering", () => {
  it("identifies degraded workloads and sorts replica-deficit / OOM / restart rows ahead of healthy ones", () => {
    const cluster = buildClusterFixture();
    const [healthy, restarting, crashing] = cluster.workloads;
    if (
      healthy === undefined ||
      restarting === undefined ||
      crashing === undefined
    ) {
      throw new Error("Expected three workloads in test fixture");
    }
    expect(isWorkloadDegraded(healthy)).toBe(false);
    expect(isWorkloadDegraded(restarting)).toBe(true);
    expect(isWorkloadDegraded(crashing)).toBe(true);

    const sorted = sortClusterWorkloads(cluster.workloads);
    expect(sorted.map((item) => item.name)).toEqual([
      "scout-worker",
      "birmel-bot",
      "arcade-web",
      "temporal-ops-worker-v42",
    ]);
  });

  it("hides retained workflow pools by default and includes them when toggled on", () => {
    const cluster = buildClusterFixture();
    expect(
      filterClusterWorkloads(cluster.workloads, false).map((w) => w.name),
    ).toEqual(["scout-worker", "birmel-bot", "arcade-web"]);
    expect(
      filterClusterWorkloads(cluster.workloads, true).map((w) => w.name),
    ).toEqual([
      "scout-worker",
      "birmel-bot",
      "arcade-web",
      "temporal-ops-worker-v42",
    ]);

    const hiddenHtml = renderClusterAt("/cluster?tab=workloads", cluster);
    expect(hiddenHtml).toContain("Include retained pools (1)");
    expect(hiddenHtml).toContain('aria-pressed="false"');
    expect(hiddenHtml).not.toContain("temporal-ops-worker-v42");
    expect(hiddenHtml.indexOf("scout-worker")).toBeLessThan(
      hiddenHtml.indexOf("birmel-bot"),
    );
    expect(hiddenHtml.indexOf("birmel-bot")).toBeLessThan(
      hiddenHtml.indexOf("arcade-web"),
    );
    expect(hiddenHtml).toContain('href="/services/scout-for-lol"');

    const shownHtml = renderClusterAt(
      "/cluster?tab=workloads&retained=1",
      cluster,
    );
    expect(shownHtml).toContain('aria-pressed="true"');
    expect(shownHtml).toContain("temporal-ops-worker-v42");
    expect(shownHtml).toContain("Retained pool");
  });
});

describe("ClusterPage URL-synced explorer tabs", () => {
  it("renders the overview strip and Nodes & Hardware tab by default", () => {
    const html = renderClusterAt("/cluster");
    expect(html).toContain("<title>Cluster · Hub</title>");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Nodes Ready");
    expect(html).toContain("2/2");
    expect(html).toContain("2 degraded requiring attention");
    expect(html).toContain("SeaweedFS volume slots");
    expect(html).toContain("SeaweedFS → B2 Lag");
    expect(html).toContain("torvalds");
    expect(html).toContain("liskov");
    expect(html).toContain("v1.34.1");
    expect(html).toContain("v1.11.5");
    expect(html).toContain("6.12.52-talos");
  });

  it("switches cleanly between databases and storage (NVMe + ZFS) tabs via ?tab=", () => {
    const dbHtml = renderClusterAt("/cluster?tab=databases");
    expect(dbHtml).toContain("delivery-postgresql");
    expect(dbHtml).toContain("postal-mariadb");
    expect(dbHtml).toContain("Backed up");

    const storageHtml = renderClusterAt("/cluster?tab=storage");
    expect(storageHtml).toContain("NVMe 5-year daily write budgets");
    expect(storageHtml).toContain("Samsung SSD 990 PRO 4TB");
    expect(storageHtml).toContain("torvalds/nvme0n1 24h write budget");
    expect(storageHtml).toContain("liskov/nvme0n1 24h write budget");
    expect(storageHtml).toContain("torvalds/zfspv-pool-nvme");
    expect(storageHtml).toContain("torvalds/zfspv-pool-hdd");
    expect(storageHtml).toContain("liskov/zfspv-pool-nvme");
  });
});

describe("Platform service views & UniversalServiceTelemetry", () => {
  it("renders Cloudflare/Tailscale, Observability sub-tabs, Temporal, and UniversalServiceTelemetry", () => {
    const client = createPopulatedClient(buildClusterFixture());
    const ingest = fixtureOpsIngest("2026-11-21T22:30:00Z");
    client.setQueryData(opsKeys.snapshot(), {
      ...ingest.snapshot,
      receivedAt: RECEIVED_AT,
      stale: false,
      newSignalIds: [],
    });

    const netHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/services/networking"] },
          renderPlatformServiceView("networking", "7d"),
        ),
      ),
    );
    expect(netHtml).toContain("sjer.red");
    expect(netHtml).toContain("DNSSEC");
    expect(netHtml).toContain("R2 storage vs 10 GiB free tier");
    expect(netHtml).toContain("Tailnet devices");

    const obsTempoHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/services/observability?tab=tempo"] },
          renderPlatformServiceView("observability", "7d"),
        ),
      ),
    );
    expect(obsTempoHtml).toContain("Service RED span metrics");
    expect(obsTempoHtml).toContain("185 ms");

    const temporalHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/services/temporal"] },
          renderPlatformServiceView("temporal", "7d"),
        ),
      ),
    );
    expect(temporalHtml).toContain("Temporal worker pools");
    expect(temporalHtml).toContain("Declarative schedules");
    expect(temporalHtml).toContain("ops-snapshot");

    for (const viewId of [
      "storage",
      "static-sites",
      "cluster-observability",
      "temporal-data",
      "cluster-platform",
      "cluster-admission",
    ] as const) {
      const viewHtml = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            MemoryRouter,
            { initialEntries: [`/services/${viewId}`] },
            renderPlatformServiceView(viewId, "7d"),
          ),
        ),
      );
      expect(viewHtml.length).toBeGreaterThan(100);
    }

    // Graceful note when Tailscale cloud API device list is unconfigured
    client.setQueryData(opsKeys.facet("tailscale"), {
      key: "tailscale",
      generatedAt: GENERATED_AT,
      receivedAt: RECEIVED_AT,
      stale: false,
      data: {
        totalDevices: 0,
        onlineDevices: 0,
        expiringKeysSoon: 0,
        clusterServicesCount: 19,
        devices: [],
      },
    });
    const unconfiguredTsHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/services/networking"] },
          renderPlatformServiceView("networking", "7d"),
        ),
      ),
    );
    expect(unconfiguredTsHtml).toContain(
      "Tailscale cloud API device list is unconfigured",
    );
    expect(unconfiguredTsHtml).toContain("Cluster Services");

    expect(renderPlatformServiceView("arcade", "7d")).toBeNull();

    const detail: ServiceDetail = {
      service: {
        id: "scout-for-lol",
        title: "Scout for LoL",
        kind: "product",
        package: "scout-for-lol",
        aliases: ["scout"],
        namespaces: ["scout-beta", "scout-prod"],
        argoApps: ["scout-beta", "scout-prod"],
        charts: [],
        images: ["scout-for-lol"],
        bootstrapImages: [],
        bugsinkProjects: ["scout-for-lol"],
        analyticsSites: ["scout-prod"],
        grafanaDashboards: [],
        deploy: [],
      },
      snapshotGeneratedAt: GENERATED_AT,
      signals: [],
      changes: [],
      links: [],
    };
    const universalHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          null,
          createElement(UniversalServiceTelemetry, { detail, range: "7d" }),
        ),
      ),
    );
    expect(universalHtml).toContain('data-target="scout-beta|scout-prod"');
    expect(universalHtml).toContain('data-target="scout-for-lol"');
    expect(universalHtml).toContain("scout-prod/scout-worker");
    expect(universalHtml).toContain("RiotUpstreamTimeoutError");

    const servicesHtml = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ["/services"] },
          createElement(ServicesPage),
        ),
      ),
    );
    expect(servicesHtml).toContain("Search services");
    expect(servicesHtml).toContain('href="/services/scout-for-lol"');
    expect(servicesHtml).toContain("views/24h");
  });
});
