import type { OpsFacets } from "@shepherdjerred/ops-model/facets.ts";
import { MailIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { APPS, TOOLS } from "./external-links.ts";
import type {
  ModuleCommand,
  ModuleSearch,
  ModuleSearchResult,
} from "./platform/module.ts";
import type { ThemePreference } from "./theme.ts";
import { trpcClient } from "./trpc.ts";
import { OpsFacetsResponseSchema } from "#shared/ops-schema";
import { ReportsFeedResponseSchema } from "#shared/reports-schema";

/**
 * The theme store reads `matchMedia` when it loads, so it is imported on use:
 * the module definitions stay importable without a DOM.
 */
async function applyTheme(preference: ThemePreference): Promise<void> {
  const theme = await import("./theme.ts");
  theme.setThemePreference(preference);
}

const SERVICE_LIMIT = 6;
const ALERT_LIMIT = 6;
const REPORT_LIMIT = 6;
const FACET_GROUP_LIMIT = 6;
const FACET_CACHE_TTL_MS = 60_000;

let cachedFacets: {
  readonly expiresAtMs: number;
  readonly promise: Promise<OpsFacets | null>;
} | null = null;

async function loadFacets(): Promise<OpsFacets | null> {
  const nowMs = globalThis.performance.now();
  if (cachedFacets !== null && nowMs < cachedFacets.expiresAtMs) {
    return cachedFacets.promise;
  }
  const promise = (async (): Promise<OpsFacets | null> => {
    try {
      const response = await globalThis.fetch("/api/v1/ops/facets", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;
      const parsed = OpsFacetsResponseSchema.safeParse(await response.json());
      return parsed.success ? parsed.data.facets : null;
    } catch {
      return null;
    }
  })();
  cachedFacets = { expiresAtMs: nowMs + FACET_CACHE_TTL_MS, promise };
  const result = await promise;
  if (result === null && cachedFacets.promise === promise) {
    cachedFacets = null;
  }
  return result;
}

/** The core module's palette commands: the apps and tools, and the theme. */
export const coreCommands: readonly ModuleCommand[] = [
  ...[...APPS, ...TOOLS].map((entry) => ({
    id: `open:${entry.id}`,
    label: `Open ${entry.label}`,
    icon: entry.icon,
    keywords: ["launch", "external"],
    run: () => {
      globalThis.open(entry.url, "_blank", "noopener,noreferrer");
    },
  })),
  {
    id: "reports:needs-review",
    label: "View Reports needing review",
    icon: MailIcon,
    keywords: [
      "reports",
      "emails",
      "attention",
      "vulnerabilities",
      "deadlinks",
    ],
    run: ({ navigate }) => {
      navigate("/reports?verdict=attention");
    },
  },
  {
    id: "theme:light",
    label: "Use light theme",
    icon: SunIcon,
    keywords: ["appearance", "mode"],
    run: () => applyTheme("light"),
  },
  {
    id: "theme:dark",
    label: "Use dark theme",
    icon: MoonIcon,
    keywords: ["appearance", "mode"],
    run: () => applyTheme("dark"),
  },
  {
    id: "theme:system",
    label: "Use system theme",
    icon: MonitorIcon,
    keywords: ["appearance", "mode", "auto"],
    run: () => applyTheme("system"),
  },
];

async function searchServices(query: string): Promise<ModuleSearchResult[]> {
  // The catalog is a large static document, so it loads with the first search
  // rather than with the app shell.
  const { ServiceIndex } = await import("@shepherdjerred/ops-model/catalog.ts");
  const needle = query.toLowerCase();
  return new ServiceIndex().services
    .filter(
      (service) =>
        service.id.toLowerCase().includes(needle) ||
        service.title.toLowerCase().includes(needle),
    )
    .slice(0, SERVICE_LIMIT)
    .map((service) => ({
      id: `service:${service.id}`,
      group: "Services",
      label: service.title,
      detail: service.id,
      to: `/services/${service.id}`,
    }));
}

/** The ledger lists newest openings first, so a match is a recent alert. */
async function searchAlerts(
  query: string,
  signal: AbortSignal,
): Promise<ModuleSearchResult[]> {
  const { items } = await trpcClient.alerts.list.query(
    { search: query, scope: "all", limit: ALERT_LIMIT },
    { signal },
  );
  return items.map((alert) => ({
    id: `alert:${alert.id}`,
    group: alert.labels["category"] === "household" ? "House" : "Alerts",
    label: alert.summary,
    detail: `${alert.alertname} · ${alert.lifecycleState}`,
    to: `/alerts/${alert.id}`,
  }));
}

async function searchFacets(
  query: string,
  signal: AbortSignal,
): Promise<ModuleSearchResult[]> {
  const facets = await loadFacets();
  if (facets === null || signal.aborted) return [];
  const needle = query.toLowerCase();

  const packages: ModuleSearchResult[] = (facets.monorepo?.packages ?? [])
    .filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(needle) ||
        pkg.path.toLowerCase().includes(needle) ||
        pkg.category.toLowerCase().includes(needle),
    )
    .slice(0, FACET_GROUP_LIMIT)
    .map((pkg) => ({
      id: `package:${pkg.name}`,
      group: "Packages",
      label: pkg.name,
      detail: `${pkg.path} · ${pkg.category}`,
      to: "/monorepo",
    }));

  const renovate: ModuleSearchResult[] = (facets.renovate?.items ?? [])
    .filter(
      (item) =>
        item.packageName.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        item.branch.toLowerCase().includes(needle) ||
        item.ecosystem.toLowerCase().includes(needle),
    )
    .slice(0, FACET_GROUP_LIMIT)
    .map((item) => ({
      id: `renovate:${item.id}`,
      group: "Renovate",
      label: item.packageName,
      detail:
        item.targetVersion === undefined || item.targetVersion === null
          ? item.state
          : `→ ${item.targetVersion} · ${item.state}`,
      to: "/renovate",
    }));

  const golinks: ModuleSearchResult[] = (facets.golink?.links ?? [])
    .filter(
      (link) =>
        `go/${link.slug}`.toLowerCase().includes(needle) ||
        link.targetUrl.toLowerCase().includes(needle) ||
        link.tier.toLowerCase().includes(needle),
    )
    .slice(0, FACET_GROUP_LIMIT)
    .map((link) => ({
      id: `golink:${link.slug}`,
      group: "Golinks",
      label: `go/${link.slug}`,
      detail: `${link.tier} · ${link.targetUrl}`,
      to: "/services/golink",
    }));

  return [...packages, ...renovate, ...golinks];
}

async function searchReports(
  query: string,
  signal: AbortSignal,
): Promise<ModuleSearchResult[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(REPORT_LIMIT),
    });
    const response = await globalThis.fetch(
      `/api/v1/reports/feed?${params.toString()}`,
      {
        headers: { accept: "application/json" },
        signal,
      },
    );
    if (!response.ok || signal.aborted) return [];
    const parsed = ReportsFeedResponseSchema.safeParse(await response.json());
    if (!parsed.success) return [];
    return parsed.data.items.slice(0, REPORT_LIMIT).map((item) => ({
      id: `report:${item.kind}:${item.id}`,
      group: "Reports",
      label: item.subject,
      detail: `${item.eyebrow} · ${item.mailboxTo}`,
      to: item.href,
    }));
  } catch {
    return [];
  }
}

/** Catalog services, workspace packages, Renovate items, Golinks, reports, and recent alerts. */
export const coreSearch: ModuleSearch = async (query, signal) => {
  const [services, alerts, facets, reports] = await Promise.all([
    searchServices(query),
    searchAlerts(query, signal),
    searchFacets(query, signal),
    searchReports(query, signal),
  ]);
  return [...services, ...facets, ...reports, ...alerts];
};
