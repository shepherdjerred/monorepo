import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  DigestKindSchema,
  type DigestKind,
} from "@shepherdjerred/ops-model/digest.ts";

import { reviewQuery } from "./ops-api.ts";
import {
  ChangeTimeline,
  IncidentPanel,
  PageHeading,
  StatusBanner,
  TrendPanel,
} from "./ops-ui.tsx";
import { SignalList } from "./signal-list.tsx";
import { SeriesChart } from "#client/charts/series-chart.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatInstant } from "#client/time.ts";
import type { DigestReport } from "#shared/ops-schema";

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
