import { StatusGlyph } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { allSignals, rankSignals } from "@shepherdjerred/ops-model/assemble.ts";
import type {
  PostHogFacet,
  PostHogFunnel,
  PostHogSite,
} from "@shepherdjerred/ops-model/facets.ts";
import { worstSeverity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Metric,
  Signal,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import {
  facetQuery,
  isSnapshotUnavailable,
  opsKeys,
  snapshotQuery,
} from "#client/ops/ops-api.ts";
import {
  ChangeTimeline,
  ExternalLink,
  MetricStrip,
  PageHeading,
  RangePicker,
  services,
} from "#client/ops/ops-ui.tsx";
import { SignalList } from "#client/ops/signal-list.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { Sparkline } from "#client/visuals/index.ts";
import {
  ChangeListResponseSchema,
  type ChangeView,
  type SeriesRange,
} from "#shared/ops-schema";
import "#styles/product.css";

export const STORM_SERVICE_IDS = [
  "minecraft",
  "storm-brain",
  "storm-forum",
] as const;

const STORM_SERVICE_SET: ReadonlySet<string> = new Set(STORM_SERVICE_IDS);

function stormChangesQuery() {
  return queryOptions({
    queryKey: [...opsKeys.all, "changes", "storm"] as const,
    queryFn: async ({ signal }): Promise<readonly ChangeView[]> => {
      const response = await fetch("/api/v1/ops/changes?limit=50", {
        headers: { accept: "application/json" },
        signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}`);
      }
      const parsed = ChangeListResponseSchema.parse(await response.json());
      return parsed.items.filter(
        (change) =>
          change.service !== undefined && STORM_SERVICE_SET.has(change.service),
      );
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

function isStormSite(site: PostHogSite): boolean {
  const host = site.host.toLowerCase();
  const key = site.siteKey?.toLowerCase() ?? "";
  return (
    host.includes("ts-mc.net") ||
    host.includes("storm") ||
    key.includes("ts-mc") ||
    key.includes("storm")
  );
}

function isStormFunnel(funnel: PostHogFunnel): boolean {
  return (
    funnel.id.toLowerCase().includes("storm") ||
    funnel.name.toLowerCase().includes("storm")
  );
}

export type StormAnalyticsSummary = {
  readonly sites: readonly PostHogSite[];
  readonly funnels: readonly PostHogFunnel[];
  readonly pageviews24h: number;
  readonly dau24h: number;
  readonly wau7d: number;
  readonly p75LcpMs: number | null;
  readonly dailySeries7d: readonly number[];
};

/** Extracts `ts-mc.net` / Storm analytics from the PostHog facet. */
export function selectStormAnalytics(
  posthog: PostHogFacet | null,
): StormAnalyticsSummary | null {
  if (posthog === null) {
    return null;
  }
  const matchedSites = posthog.sites.filter((site) => isStormSite(site));
  const matchedFunnels = posthog.funnels.filter((funnel) =>
    isStormFunnel(funnel),
  );
  if (matchedSites.length === 0 && matchedFunnels.length === 0) {
    return null;
  }
  let maxLcp: number | null = null;
  for (const site of matchedSites) {
    if (site.p75LcpMs !== null) {
      maxLcp =
        maxLcp === null ? site.p75LcpMs : Math.max(maxLcp, site.p75LcpMs);
    }
  }
  return {
    sites: matchedSites,
    funnels: matchedFunnels,
    pageviews24h: matchedSites.reduce((sum, s) => sum + s.pageviews24h, 0),
    dau24h: matchedSites.reduce((sum, s) => sum + s.dau24h, 0),
    wau7d: matchedSites.reduce((sum, s) => sum + s.wau7d, 0),
    p75LcpMs: maxLcp,
    dailySeries7d: matchedSites[0]?.dailySeries7d ?? [],
  };
}

function StormServiceCards({
  signals,
}: {
  readonly signals: readonly Signal[];
}): React.JSX.Element {
  return (
    <ul className="storm-service-grid" aria-label="Storm services">
      {STORM_SERVICE_IDS.map((serviceId) => {
        const service = services.byId(serviceId);
        const own = signals.filter((signal) => signal.service === serviceId);
        const severity = worstSeverity(own.map((signal) => signal.severity));
        return (
          <li key={serviceId}>
            <Link className="service-card" to={`/services/${serviceId}`}>
              <strong>{service?.title ?? serviceId}</strong>
              <StatusGlyph severity={severity} />
              <span className="service-sub">
                {own.length === 0
                  ? "No active signals"
                  : `${String(own.length)} signal${own.length === 1 ? "" : "s"}`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StormAnalyticsPanel({
  analytics,
}: {
  readonly analytics: StormAnalyticsSummary;
}): React.JSX.Element {
  const metrics: readonly Metric[] = [
    {
      id: "storm.pageviews.24h",
      label: "ts-mc.net 24h Pageviews",
      value: analytics.pageviews24h,
      unit: "count",
      severity: "ok",
      source: "posthog",
    },
    {
      id: "storm.dau.24h",
      label: "ts-mc.net 24h DAU",
      value: analytics.dau24h,
      unit: "count",
      severity: "ok",
      source: "posthog",
    },
    {
      id: "storm.wau.7d",
      label: "ts-mc.net 7d WAU",
      value: analytics.wau7d,
      unit: "count",
      severity: "ok",
      source: "posthog",
    },
    {
      id: "storm.lcp.p75",
      label: "ts-mc.net p75 LCP",
      value: analytics.p75LcpMs,
      unit: "ms",
      severity:
        analytics.p75LcpMs !== null && analytics.p75LcpMs > 2500
          ? "warning"
          : "ok",
      source: "posthog",
    },
  ];
  const primaryFunnel = analytics.funnels[0];
  const entry = primaryFunnel?.steps[0]?.count7d ?? 0;
  const finalStep = primaryFunnel?.steps.at(-1);

  return (
    <section
      className="storm-analytics-panel"
      aria-labelledby="storm-web-heading"
    >
      <div className="storm-analytics-head">
        <h2 id="storm-web-heading">ts-mc.net community traffic</h2>
        {analytics.dailySeries7d.length === 0 ? null : (
          <div className="product-trend-cell">
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              7d pageviews
            </span>
            <Sparkline
              values={analytics.dailySeries7d}
              width={96}
              height={24}
              tone="good"
            />
          </div>
        )}
      </div>
      <MetricStrip metrics={metrics} />
      {primaryFunnel === undefined || finalStep === undefined ? null : (
        <p style={{ margin: 0, fontSize: "0.84rem" }}>
          <strong>{primaryFunnel.name}:</strong>{" "}
          {`${String(finalStep.count7d)} of ${String(entry)} 7d visitors reached "${finalStep.label}" (${entry > 0 ? String(Math.round((finalStep.count7d / entry) * 100)) : "0"}%).`}
        </p>
      )}
    </section>
  );
}

export function TheStormPageView({
  range,
  onRangeChange,
  snapshot,
  posthog,
  changes,
}: {
  readonly range: SeriesRange;
  readonly onRangeChange: (next: SeriesRange) => void;
  readonly snapshot: SnapshotResponse | null;
  readonly posthog: PostHogFacet | null;
  readonly changes: readonly ChangeView[];
}): React.JSX.Element {
  const stormSignals =
    snapshot === null
      ? []
      : rankSignals(
          allSignals(snapshot).filter(
            (signal) =>
              signal.service !== undefined &&
              STORM_SERVICE_SET.has(signal.service),
          ),
        );
  const overallSeverity =
    snapshot === null
      ? "unknown"
      : worstSeverity(stormSignals.map((signal) => signal.severity));
  const analytics = selectStormAnalytics(posthog);
  const stormChanges = changes.filter(
    (change) =>
      change.service === undefined || STORM_SERVICE_SET.has(change.service),
  );

  return (
    <>
      <PageHeading title="The Storm" meta="Minecraft & community">
        <StatusGlyph severity={overallSeverity} />
      </PageHeading>
      <nav className="storm-quick-links" aria-label="The Storm quick links">
        <Link className="button" to="/promotion">
          Promotion
        </Link>
        <Link className="button" to="/services/minecraft">
          Minecraft service
        </Link>
        <Link className="button" to="/services/storm-brain">
          Storm Brain
        </Link>
        <Link className="button" to="/services/storm-forum">
          Storm Forum
        </Link>
        <ExternalLink
          className="button"
          link={{
            kind: "native",
            label: "ts-mc.net",
            url: "https://ts-mc.net",
          }}
        />
      </nav>
      <StormServiceCards signals={stormSignals} />
      {analytics === null ? null : (
        <StormAnalyticsPanel analytics={analytics} />
      )}
      <div className="charts-heading">
        <h2 className="block-heading">
          Players, companion & cluster resources
        </h2>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>
      <div className="chart-grid">
        <SeriesChart
          preset="storm-players"
          range={range}
          title="Online players by edition"
          syncKey="storm"
        />
        <SeriesChart
          preset="storm-brain-requests"
          range={range}
          mode="bar"
          title="Storm Brain companion requests"
          syncKey="storm"
        />
        <SeriesChart
          preset="namespace-cpu"
          target="minecraft"
          range={range}
          title="Minecraft namespace CPU"
          syncKey="storm"
        />
        <SeriesChart
          preset="namespace-memory"
          target="minecraft"
          range={range}
          title="Minecraft namespace memory"
          syncKey="storm"
        />
      </div>
      <div className="service-layout">
        <section
          className="panel list-panel"
          aria-labelledby="storm-signals-heading"
        >
          <header className="panel-heading">
            <h2 id="storm-signals-heading">
              Storm signals <span className="count">{stormSignals.length}</span>
            </h2>
          </header>
          <SignalList
            signals={stormSignals}
            empty="No active signals across Minecraft, Storm Brain, or Storm Forum."
            label="Storm signals"
            newIds={new Set(snapshot?.newSignalIds)}
          />
        </section>
        <section
          className="panel list-panel"
          aria-labelledby="storm-changes-heading"
        >
          <header className="panel-heading">
            <h2 id="storm-changes-heading">Recent changes</h2>
          </header>
          <ChangeTimeline changes={stormChanges} />
        </section>
      </div>
    </>
  );
}

export function TheStormPage(): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const snapshotState = Loaded.fromQuery(useQuery(snapshotQuery()));
  const posthogState = Loaded.fromQuery(useQuery(facetQuery("posthog")));
  const changesState = Loaded.fromQuery(useQuery(stormChangesQuery()));

  const snapshot = Loaded.getOrElse(snapshotState, null);
  const posthogEnvelope = Loaded.getOrElse(posthogState, null);
  const changes = Loaded.getOrElse(changesState, []);
  const degradedErrors = [
    ...(snapshotState.status === "degraded" ? snapshotState.errors : []),
    ...(posthogState.status === "degraded" ? posthogState.errors : []),
  ];

  return (
    <main className="product-scope">
      <title>The Storm · Hub</title>
      <StaleNotice errors={degradedErrors} />
      {snapshotState.status === "error" && posthogState.status === "error" ? (
        isSnapshotUnavailable(snapshotState.errors[0].error) ? (
          <div className="empty-state">
            No ops snapshot has been ingested yet. The Temporal ops-snapshot
            workflow posts one every five minutes.
          </div>
        ) : (
          <div className="error-state" role="alert">
            The Storm overview is currently unavailable.
          </div>
        )
      ) : (
        <TheStormPageView
          range={range}
          onRangeChange={setRange}
          snapshot={snapshot}
          posthog={posthogEnvelope?.data ?? null}
          changes={changes}
        />
      )}
    </main>
  );
}
