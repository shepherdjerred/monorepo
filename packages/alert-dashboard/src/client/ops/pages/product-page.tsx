import { Loaded } from "@shepherdjerred/loaded";
import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import type { PostHogFacet } from "@shepherdjerred/ops-model/facets.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Metric,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { useQuery } from "@tanstack/react-query";

import { SeriesChart } from "#client/charts/series-chart.tsx";
import { useRange } from "#client/charts/use-range.ts";
import {
  facetQuery,
  isSnapshotUnavailable,
  snapshotQuery,
} from "#client/ops/ops-api.ts";
import {
  MetricTile,
  PageHeading,
  RangePicker,
  SectionSummary,
  SeverityBadge,
} from "#client/ops/ops-ui.tsx";
import { SignalList } from "#client/ops/signal-list.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import type { SeriesRange } from "#shared/ops-schema";
import "#styles/product.css";

import { ProductPostHogSections } from "./product-sections.tsx";

export type LcpBadge = {
  readonly label: "Good" | "Needs Improvement" | "Poor" | "No data";
  readonly glyph: "✓" | "!" | "✕" | "—";
  readonly tone: "ok" | "warning" | "error" | "neutral";
};

/** Core Web Vitals p75 LCP classification: <=2500ms Good, <=4000ms Needs Improvement, >4000ms Poor. */
export function classifyLcpMs(value: number | null): LcpBadge {
  if (value === null || !Number.isFinite(value)) {
    return { label: "No data", glyph: "—", tone: "neutral" };
  }
  if (value <= 2500) {
    return { label: "Good", glyph: "✓", tone: "ok" };
  }
  return value <= 4000
    ? { label: "Needs Improvement", glyph: "!", tone: "warning" }
    : { label: "Poor", glyph: "✕", tone: "error" };
}

/** Step-to-step retention percentage in `[0, 100]`. */
export function computeStepRetention(
  current: number,
  previous: number | null,
): number {
  if (previous === null) {
    return 100;
  }
  return !Number.isFinite(previous) ||
    previous <= 0 ||
    !Number.isFinite(current)
    ? 0
    : Math.min(100, Math.max(0, Math.round((current / previous) * 100)));
}

function posthogKpi(
  id: string,
  label: string,
  value: number | null,
  severity: Severity,
): Metric {
  return { id, label, value, unit: "count", severity, source: "posthog" };
}

function buildHeadlineMetrics(posthog: PostHogFacet | null): readonly Metric[] {
  const baseSeverity: Severity = posthog === null ? "unknown" : "ok";
  const exceptions = posthog?.totalExceptions24h ?? null;
  const exceptionSeverity: Severity =
    exceptions === null ? "unknown" : exceptions > 0 ? "warning" : "ok";
  return [
    posthogKpi(
      "posthog.pageviews.24h",
      "24h Pageviews",
      posthog?.totalPageviews24h ?? null,
      baseSeverity,
    ),
    posthogKpi(
      "posthog.dau.24h",
      "24h Active Users (DAU)",
      posthog?.totalDau24h ?? null,
      baseSeverity,
    ),
    posthogKpi(
      "posthog.wau.7d",
      "7d Weekly Active Users (WAU)",
      posthog?.totalWau7d ?? null,
      baseSeverity,
    ),
    posthogKpi(
      "posthog.exceptions.24h",
      "24h Client Exceptions",
      exceptions,
      exceptionSeverity,
    ),
  ];
}

export function ProductPageView({
  range,
  onRangeChange,
  snapshot,
  posthog,
}: {
  readonly range: SeriesRange;
  readonly onRangeChange: (next: SeriesRange) => void;
  readonly snapshot: SnapshotResponse | null;
  readonly posthog: PostHogFacet | null;
}): React.JSX.Element {
  const productSection =
    snapshot === null ? null : findSection(snapshot, "product");
  const kpis = buildHeadlineMetrics(posthog);

  return (
    <>
      <PageHeading eyebrow="Web analytics & vitals" title="Product">
        {productSection === null ? null : (
          <SeverityBadge severity={productSection.severity} large />
        )}
      </PageHeading>
      {productSection === null ? null : (
        <SectionSummary
          section={productSection}
          headingId="product-probe-summary"
        />
      )}
      <section aria-label="Headline analytics metrics">
        <div className="product-kpi-grid">
          {kpis.map((metric) => (
            <MetricTile key={metric.id} metric={metric} />
          ))}
        </div>
      </section>
      <div className="charts-heading">
        <h2 className="block-heading">Traffic & Web Vitals trends</h2>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>
      <div className="chart-grid">
        <SeriesChart
          preset="posthog-pageviews-by-site"
          range={range}
          mode="stacked-area"
          title="Pageviews by site (24h rolling)"
          syncKey="product"
        />
        <SeriesChart
          preset="posthog-dau-by-site"
          range={range}
          title="Daily active users by site"
          syncKey="product"
        />
        <SeriesChart
          preset="posthog-lcp-p75"
          range={range}
          threshold={{ value: 2500, label: "CWV Good 2.5s", tone: "warning" }}
          title="Web Vitals p75 LCP"
          syncKey="product"
        />
        <SeriesChart
          preset="scout-matches"
          range={range}
          mode="bar"
          title="Scout matches processed"
          syncKey="product"
        />
      </div>
      {posthog === null ? (
        <div className="empty-state">
          No PostHog analytics facet has been ingested yet.
        </div>
      ) : (
        <ProductPostHogSections
          posthog={posthog}
          classifyLcp={classifyLcpMs}
          computeRetention={computeStepRetention}
        />
      )}
      {productSection === null || productSection.signals.length === 0 ? null : (
        <section
          className="panel list-panel"
          aria-labelledby="product-signals-heading"
          style={{ marginTop: "18px" }}
        >
          <header className="panel-heading">
            <h2 id="product-signals-heading">
              Product signals{" "}
              <span className="count">{productSection.signals.length}</span>
            </h2>
          </header>
          <SignalList
            signals={productSection.signals}
            empty="No product signals."
            newIds={new Set(snapshot?.newSignalIds)}
          />
        </section>
      )}
    </>
  );
}

export function ProductPage(): React.JSX.Element {
  const [range, setRange] = useRange("7d");
  const snapshotState = Loaded.fromQuery(useQuery(snapshotQuery()));
  const posthogState = Loaded.fromQuery(useQuery(facetQuery("posthog")));

  const snapshot = Loaded.getOrElse(snapshotState, null);
  const posthogEnvelope = Loaded.getOrElse(posthogState, null);
  const degradedErrors = [
    ...(snapshotState.status === "degraded" ? snapshotState.errors : []),
    ...(posthogState.status === "degraded" ? posthogState.errors : []),
  ];

  return (
    <main className="product-scope">
      <title>Product · Hub</title>
      <StaleNotice errors={degradedErrors} />
      {snapshotState.status === "error" && posthogState.status === "error" ? (
        isSnapshotUnavailable(snapshotState.errors[0].error) ? (
          <div className="empty-state">
            No ops snapshot has been ingested yet. The Temporal ops-snapshot
            workflow posts one every five minutes.
          </div>
        ) : (
          <div className="error-state" role="alert">
            Product telemetry is currently unavailable.
          </div>
        )
      ) : (
        <ProductPageView
          range={range}
          onRangeChange={setRange}
          snapshot={snapshot}
          posthog={posthogEnvelope?.data ?? null}
        />
      )}
    </main>
  );
}
