import { StatusGlyph } from "@shepherdjerred/console-ui";
import { allSignals } from "@shepherdjerred/ops-model/assemble.ts";
import type { Service } from "@shepherdjerred/ops-model/catalog.ts";
import type { OpsFacets } from "@shepherdjerred/ops-model/facets.ts";
import {
  worstSeverity,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import type {
  Signal,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";

import { facetsQuery } from "./ops-api.ts";
import {
  PageHeading,
  WithSnapshot,
  services as serviceCatalog,
} from "./ops-ui.tsx";
import { Sparkline } from "#client/visuals/index.ts";
import { Input } from "#components/input";
import { formatValue } from "#shared/ops-format";
import "#styles/platform.css";

type ServiceFilter = "all" | "attention" | "product" | "workload" | "platform";

type EnrichedServiceRow = {
  readonly service: Service;
  readonly ownSignals: readonly Signal[];
  readonly severity: Severity;
  readonly needsAttention: boolean;
  readonly searchHaystack: string;
};

const KINDS = ["product", "workload", "platform"] as const;

const KIND_HEADING: Record<(typeof KINDS)[number], string> = {
  product: "Products",
  workload: "Workloads",
  platform: "Platform",
};

function computePostHogSummary(
  service: Service,
  facets: OpsFacets | undefined,
): { readonly series7d: readonly number[]; readonly views24h: number } | null {
  if (service.analyticsSites.length === 0 || facets?.posthog === undefined) {
    return null;
  }
  const siteSet = new Set(service.analyticsSites);
  const matched = facets.posthog.sites.filter(
    (site) => site.siteKey !== null && siteSet.has(site.siteKey),
  );
  if (matched.length === 0) {
    return null;
  }
  const maxLen = Math.max(
    0,
    ...matched.map((site) => site.dailySeries7d.length),
  );
  const series7d = Array.from({ length: maxLen }, (_, dayIdx) =>
    matched.reduce((sum, site) => sum + (site.dailySeries7d[dayIdx] ?? 0), 0),
  );
  const views24h = matched.reduce((sum, site) => sum + site.pageviews24h, 0);
  return { series7d, views24h };
}

function computeBugsinkActiveCount(
  service: Service,
  facets: OpsFacets | undefined,
): number | null {
  if (service.bugsinkProjects.length === 0 || facets?.bugsink === undefined) {
    return null;
  }
  const slugSet = new Set(service.bugsinkProjects);
  const matched = facets.bugsink.projects.filter((proj) =>
    slugSet.has(proj.slug),
  );
  return matched.length === 0
    ? null
    : matched.reduce((sum, proj) => sum + proj.activeIssues7d, 0);
}

function computeWorkloadPodSummary(
  service: Service,
  facets: OpsFacets | undefined,
): { readonly ready: number; readonly desired: number } | null {
  if (facets?.cluster === undefined) {
    return null;
  }
  const nsSet = new Set(service.namespaces);
  const matched = facets.cluster.workloads.filter(
    (workload) =>
      !workload.retainedPool &&
      (workload.serviceId === service.id || nsSet.has(workload.namespace)),
  );
  if (matched.length === 0) {
    return null;
  }
  return {
    ready: matched.reduce((sum, item) => sum + item.readyReplicas, 0),
    desired: matched.reduce((sum, item) => sum + item.desiredReplicas, 0),
  };
}

function computeFlagCount(
  service: Service,
  facets: OpsFacets | undefined,
): number | null {
  if (facets === undefined) {
    return null;
  }
  const pkgMatch = facets.monorepo?.packages.find(
    (pkg) => pkg.serviceId === service.id && pkg.flagCount > 0,
  );
  if (pkgMatch !== undefined) {
    return pkgMatch.flagCount;
  }
  if (facets.flipt === undefined) {
    return null;
  }
  const keys = new Set([service.id, ...service.aliases]);
  const nsMatches = facets.flipt.namespaces.filter((ns) =>
    keys.has(ns.namespace),
  );
  return nsMatches.length === 0
    ? null
    : nsMatches.reduce((sum, ns) => sum + ns.flagCount, 0);
}

function ServiceSummaryChips({
  service,
  facets,
}: {
  readonly service: Service;
  readonly facets: OpsFacets | undefined;
}): React.JSX.Element | null {
  const analytics = computePostHogSummary(service, facets);
  const pods = computeWorkloadPodSummary(service, facets);
  const bugsinkActive = computeBugsinkActiveCount(service, facets);
  const flags = computeFlagCount(service, facets);

  if (
    analytics === null &&
    pods === null &&
    bugsinkActive === null &&
    flags === null
  ) {
    return null;
  }

  return (
    <span className="service-card-chips">
      {analytics === null ? null : (
        <span className="service-spark-chip">
          <Sparkline
            values={analytics.series7d}
            width={60}
            height={16}
            tone="neutral"
          />
          <span>{`${formatValue(analytics.views24h, "count")} views/24h`}</span>
        </span>
      )}
      {pods === null ? null : (
        <span className="service-metric-chip">
          {`${String(pods.ready)}/${String(pods.desired)} ready`}
        </span>
      )}
      {bugsinkActive === null ? null : (
        <span className="service-metric-chip">
          {`${String(bugsinkActive)} bugsink`}
        </span>
      )}
      {flags === null ? null : (
        <span className="service-metric-chip">{`${String(flags)} flags`}</span>
      )}
    </span>
  );
}

function matchesServiceFilter(
  row: EnrichedServiceRow,
  filter: ServiceFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "attention":
      return row.needsAttention;
    case "product":
    case "workload":
    case "platform":
      return row.service.kind === filter;
  }
}

function ServiceGrid({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const facetsQueryResult = useQuery(facetsQuery());
  const facets = facetsQueryResult.data?.facets;

  const rows = useMemo((): readonly EnrichedServiceRow[] => {
    const signals = allSignals(snapshot);
    return serviceCatalog.services.map((service) => {
      const ownSignals = signals.filter(
        (signal) => signal.service === service.id,
      );
      const severity = worstSeverity(
        ownSignals.map((signal) => signal.severity),
      );
      const needsAttention =
        severity === "error" ||
        severity === "warning" ||
        severity === "unknown" ||
        ownSignals.some((signal) => signal.needsMe);
      const searchHaystack = [
        service.title,
        service.id,
        service.package ?? "",
        ...service.aliases,
        ...service.namespaces,
        ...service.argoApps,
        ...service.bugsinkProjects,
        ...service.analyticsSites,
      ]
        .join(" ")
        .toLowerCase();
      return { service, ownSignals, severity, needsAttention, searchHaystack };
    });
  }, [snapshot]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        matchesServiceFilter(row, filter) &&
        (needle.length === 0 || row.searchHaystack.includes(needle)),
    );
  }, [filter, query, rows]);

  const filterOptions: readonly {
    readonly value: ServiceFilter;
    readonly label: string;
    readonly count: number;
  }[] = [
    { value: "all", label: "All", count: rows.length },
    {
      value: "attention",
      label: "Needs attention",
      count: rows.filter((row) => row.needsAttention).length,
    },
    {
      value: "product",
      label: "Products",
      count: rows.filter((row) => row.service.kind === "product").length,
    },
    {
      value: "workload",
      label: "Workloads",
      count: rows.filter((row) => row.service.kind === "workload").length,
    },
    {
      value: "platform",
      label: "Platform",
      count: rows.filter((row) => row.service.kind === "platform").length,
    },
  ];

  return (
    <>
      <PageHeading title="Services" />
      <div className="services-toolbar">
        <label htmlFor={searchId} className="visual-search">
          <span className="sr-only">Search services</span>
          <SearchIcon aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder="Search services, namespaces, packages…"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </label>
        <div
          className="segmented visual-filter-pills"
          role="radiogroup"
          aria-label="Filter services"
        >
          {filterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={filter === option.value}
              onClick={() => {
                setFilter(option.value);
              }}
            >
              {option.label}
              <span className="segmented-count">{option.count}</span>
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="empty-state">No services match the active filter.</p>
      ) : (
        KINDS.map((kind) => {
          const group = filtered.filter((row) => row.service.kind === kind);
          if (group.length === 0) {
            return null;
          }
          return (
            <section key={kind} aria-labelledby={`kind-${kind}`}>
              <h2 className="block-heading" id={`kind-${kind}`}>
                {KIND_HEADING[kind]}
              </h2>
              <ul className="service-grid">
                {group.map(({ service, ownSignals, severity }) => (
                  <li key={service.id}>
                    <Link
                      className="service-card"
                      to={`/services/${service.id}`}
                    >
                      <strong>{service.title}</strong>
                      <StatusGlyph severity={severity} />
                      <span className="service-sub">
                        {ownSignals.length === 0
                          ? "No signals"
                          : `${String(ownSignals.length)} signal${ownSignals.length === 1 ? "" : "s"}`}
                      </span>
                      <ServiceSummaryChips service={service} facets={facets} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

export function ServicesPage(): React.JSX.Element {
  return (
    <WithSnapshot title="Services">
      {(snapshot) => <ServiceGrid snapshot={snapshot} />}
    </WithSnapshot>
  );
}
