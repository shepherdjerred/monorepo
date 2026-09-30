import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { useSearchParams } from "react-router";

import { reviewQuery } from "./ops-api.ts";
import {
  ChangeTimeline,
  PageHeading,
  SeverityBadge,
  SignalList,
} from "./ops-ui.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatInstant } from "#client/time.ts";
import { formatDelta, formatValue, trendDelta } from "#shared/ops-format";
import {
  DigestKindSchema,
  type DigestKind,
  type DigestReport,
  type Trend,
} from "#shared/ops-schema";

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

function ReviewBody({
  report,
}: {
  readonly report: DigestReport;
}): React.JSX.Element {
  const { incidents } = report;
  return (
    <>
      <section
        className={`status-banner status-${report.status.severity}`}
        aria-label="Status"
      >
        <SeverityBadge severity={report.status.severity} large />
        <div>
          <p className="status-summary">{report.status.summary}</p>
          <p className="status-meta">
            {formatInstant(report.periodStart)} –{" "}
            {formatInstant(report.periodEnd)}
          </p>
        </div>
      </section>
      <div className="review-grid">
        {report.trends.length === 0 ? null : (
          <section className="panel" aria-labelledby="trends-heading">
            <header className="panel-heading">
              <h2 id="trends-heading">Compared with the previous week</h2>
            </header>
            <div className="table-scroll">
              <table className="trend-table">
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
                  {report.trends.map((trend) => (
                    <TrendRow key={trend.id} trend={trend} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <div className="stack">
          <section
            className="panel incident-panel"
            aria-labelledby="incident-heading"
          >
            <header className="panel-heading">
              <h2 id="incident-heading">Incidents</h2>
            </header>
            <div className="metric-row">
              <div className="metric">
                <span>Opened</span>
                <strong>{incidents.opened}</strong>
              </div>
              <div className="metric">
                <span>Resolved</span>
                <strong>{incidents.resolved}</strong>
              </div>
              <div className="metric">
                <span>Median to resolve</span>
                <strong>
                  {incidents.medianMinutesToResolve === null
                    ? "—"
                    : `${String(Math.round(incidents.medianMinutesToResolve))}m`}
                </strong>
              </div>
            </div>
          </section>
          <section className="panel list-panel" aria-labelledby="review-new">
            <header className="panel-heading">
              <h2 id="review-new">
                {report.kind === "daily"
                  ? "New since the last digest"
                  : "New this period"}
              </h2>
            </header>
            <SignalList
              signals={report.newSinceLast}
              empty="Nothing new."
              limit={10}
            />
          </section>
        </div>
      </div>
      <div className="chart-grid">
        <SeriesChart preset="prs-merged" range="90d" />
        <SeriesChart preset="alerts-firing" range="30d" />
        <SeriesChart preset="ai-cost-by-source" range="30d" />
        <SeriesChart preset="bugsink-unresolved" range="90d" />
      </div>
      <section className="panel list-panel" aria-labelledby="review-changes">
        <header className="panel-heading">
          <h2 id="review-changes">Changes</h2>
        </header>
        <ChangeTimeline changes={report.changes.slice(0, 50)} />
      </section>
    </>
  );
}

export function ReviewPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const parsed = DigestKindSchema.safeParse(params.get("kind"));
  const kind: DigestKind = parsed.success ? parsed.data : "weekly";
  const report = Loaded.fromQuery(useQuery(reviewQuery(kind)));
  return (
    <main>
      <title>Review · Ops</title>
      <PageHeading eyebrow="How did it go" title="Review">
        <div className="segmented" role="radiogroup" aria-label="Period">
          {DigestKindSchema.options.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === kind}
              onClick={() => {
                setParams({ kind: option }, { replace: true });
              }}
            >
              {option === "weekly" ? "Week" : "Day"}
            </button>
          ))}
        </div>
      </PageHeading>
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
            <ReviewBody report={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}
