import { FigureStrip, Tabs } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import {
  DigestKindSchema,
  type DigestKind,
} from "@shepherdjerred/ops-model/digest.ts";

import { reviewQuery } from "./ops-api.ts";
import { ChangeTimeline, PageHeading, StatusBanner } from "./ops-ui.tsx";
import { SignalList } from "./signal-list.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatInstant } from "#client/time.ts";
import { formatDelta, formatValue, trendDelta } from "#shared/ops-format";
import { type DigestReport, type Trend } from "#shared/ops-schema";

function TrendRow({ trend }: { readonly trend: Trend }): React.JSX.Element {
  const delta = trendDelta(trend);
  const direction =
    delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const good =
    direction === "flat" ? null : (direction === "up") === trend.higherIsBetter;
  const Icon =
    direction === "up"
      ? ArrowUpRightIcon
      : direction === "down"
        ? ArrowDownRightIcon
        : MinusIcon;
  return (
    <tr>
      <th scope="row">{trend.label}</th>
      <td className="num">{formatValue(trend.current, trend.unit)}</td>
      <td className="num muted">{formatValue(trend.previous, trend.unit)}</td>
      <td
        className={`num delta ${good === null ? "delta-flat" : good ? "delta-good" : "delta-bad"}`}
      >
        <Icon aria-hidden="true" /> {formatDelta(delta, trend.unit)}
      </td>
    </tr>
  );
}

/** Trends compare whole weeks, so only the weekly report carries them. */
function TrendPanel({
  trends,
}: {
  readonly trends: readonly Trend[];
}): React.JSX.Element {
  return (
    <section className="panel" aria-labelledby="trends-heading">
      <header className="panel-heading">
        <h2 id="trends-heading">Compared with the previous week</h2>
      </header>
      <div className="table-scroll">
        <table className="trend-table ui-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" className="num">
                This week
              </th>
              <th scope="col" className="num">
                Previous
              </th>
              <th scope="col" className="num">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {trends.map((trend) => (
              <TrendRow key={trend.id} trend={trend} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const PERIOD_OPTIONS = DigestKindSchema.options.map((option) => ({
  value: option,
  label: option === "weekly" ? "Week" : "Day",
}));

function IncidentPanel({
  incidents,
}: {
  readonly incidents: DigestReport["incidents"];
}): React.JSX.Element {
  return (
    <section
      className="panel incident-panel"
      aria-labelledby="incident-heading"
    >
      <header className="panel-heading">
        <h2 id="incident-heading">Incidents</h2>
      </header>
      <FigureStrip
        figures={[
          { label: "Opened", value: incidents.opened },
          { label: "Resolved", value: incidents.resolved },
          {
            label: "Median to resolve",
            value:
              incidents.medianMinutesToResolve === null
                ? "—"
                : `${String(Math.round(incidents.medianMinutesToResolve))}m`,
          },
        ]}
      />
    </section>
  );
}

/** The verdict for the period, then its numbers. */
function ReviewLead({
  report,
}: {
  readonly report: DigestReport;
}): React.JSX.Element {
  return (
    <>
      <StatusBanner
        severity={report.status.severity}
        summary={report.status.summary}
        label="Status"
      >
        {formatInstant(report.periodStart)} – {formatInstant(report.periodEnd)}
      </StatusBanner>
      <div className="review-grid">
        {report.trends.length === 0 ? null : (
          <TrendPanel trends={report.trends} />
        )}
        <IncidentPanel incidents={report.incidents} />
      </div>
    </>
  );
}

/** The lists that take reading: what is new, beside what changed. */
function ReviewLists({
  report,
}: {
  readonly report: DigestReport;
}): React.JSX.Element {
  return (
    <div className="review-lists">
      <section className="panel list-panel" aria-labelledby="review-new">
        <header className="panel-heading">
          <h2 id="review-new">
            {report.kind === "daily"
              ? "New since the last digest"
              : "New this period"}{" "}
            <span className="count">{report.newSinceLast.length}</span>
          </h2>
        </header>
        <SignalList signals={report.newSinceLast} empty="Nothing new." />
      </section>
      <section className="panel list-panel" aria-labelledby="review-changes">
        <header className="panel-heading">
          <h2 id="review-changes">Changes</h2>
        </header>
        <ChangeTimeline changes={report.changes} />
      </section>
    </div>
  );
}

/**
 * The report fills the top and the bottom of the page; the charts between
 * them read Prometheus on their own, so they are not held behind it. The top
 * block keeps its height while the report loads, so the charts do not jump
 * when it lands.
 */
export function ReviewPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const parsed = DigestKindSchema.safeParse(params.get("kind"));
  const kind: DigestKind = parsed.success ? parsed.data : "weekly";
  const report = Loaded.fromQuery(useQuery(reviewQuery(kind)));
  return (
    <main>
      <title>Review · Hub</title>
      <PageHeading title="Review">
        <Tabs
          label="Period"
          options={PERIOD_OPTIONS}
          value={kind}
          onChange={(option) => {
            setParams({ kind: option }, { replace: true });
          }}
        />
      </PageHeading>
      <div
        className={`review-lead review-lead-${kind}`}
        aria-busy={report.status === "loading"}
      >
        <LoadingBlock
          values={{ report }}
          fallback={<div className="loading-state">Loading review…</div>}
          renderError={() => (
            <div className="error-state">The review is unavailable.</div>
          )}
        >
          {({ report: value }, meta) => (
            <>
              <StaleNotice errors={meta.errors} />
              <ReviewLead report={value} />
            </>
          )}
        </LoadingBlock>
      </div>
      <h2 className="block-heading">Trends</h2>
      <div className="chart-grid">
        <SeriesChart preset="prs-merged" range="90d" />
        <SeriesChart preset="alerts-firing" range="30d" />
        <SeriesChart preset="ai-cost-by-source" range="30d" />
        <SeriesChart preset="bugsink-unresolved" range="90d" />
      </div>
      {/* The top block already reports loading and failure. */}
      <LoadingBlock
        values={{ report }}
        fallback={null}
        renderError={() => null}
      >
        {({ report: value }) => <ReviewLists report={value} />}
      </LoadingBlock>
    </main>
  );
}
