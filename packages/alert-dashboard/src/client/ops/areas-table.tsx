import { StatusGlyph } from "@shepherdjerred/console-ui";
import { isAttention } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Metric,
  Section,
  SectionId,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { Link } from "react-router";

import { formatValue } from "#shared/ops-format";

/** Where each area's row links for its detail. */
const SECTION_PAGES: Partial<Record<SectionId, string>> = {
  alerts: "/alerts",
  delivery: "/flow",
  work: "/flow",
  ai: "/ai",
  maintenance: "/maintenance",
  errors: "/maintenance",
  platform: "/maintenance",
  observability: "/maintenance",
  product: "/product",
};

type AreaCounts = {
  readonly issues: number;
  readonly informational: number;
  readonly waiting: number;
};

/** The counts the snapshot's own section summary is built from. */
function areaCounts(section: Section): AreaCounts {
  return {
    issues: section.signals.filter((signal) => isAttention(signal.severity))
      .length,
    informational: section.signals.filter(
      (signal) => signal.severity === "info",
    ).length,
    waiting: section.signals.filter((signal) => signal.needsMe).length,
  };
}

/**
 * A key metric as a chip. A metric that needs attention colours its value
 * and adds its severity glyph, whose word stays for assistive technology.
 */
function MetricChip({
  metric,
}: {
  readonly metric: Metric;
}): React.JSX.Element {
  const flagged = isAttention(metric.severity);
  return (
    <span
      className="ui-chip"
      {...(flagged ? { "data-sev": metric.severity } : {})}
    >
      {metric.label}
      <b className="ui-chip-value">{formatValue(metric.value, metric.unit)}</b>
      {flagged ? <StatusGlyph severity={metric.severity} hideLabel /> : null}
    </span>
  );
}

/** The issue count beside a bar scaled to the area with the most issues. */
function IssuesCell({
  count,
  max,
  severity,
  area,
}: {
  readonly count: number;
  readonly max: number;
  readonly severity: Section["severity"];
  readonly area: string;
}): React.JSX.Element {
  const percent = max === 0 ? 0 : (count / max) * 100;
  return (
    <td className="num">
      <span
        className="ui-meter"
        data-sev={severity}
        role="meter"
        aria-label={`${area} issues`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={count}
      >
        <span className="ui-meter-track" aria-hidden="true">
          <span
            className="ui-meter-fill"
            style={{ width: `${String(percent)}%` }}
          />
        </span>
        <span
          className={count === 0 ? "ui-meter-text ui-zero" : "ui-meter-text"}
        >
          {count}
        </span>
      </span>
    </td>
  );
}

function CountCell({ count }: { readonly count: number }): React.JSX.Element {
  return <td className={count === 0 ? "num ui-zero" : "num"}>{count}</td>;
}

/**
 * Every area of the snapshot as one row: its verdict as a glyph and word,
 * its issues against the busiest area's, its informational and waiting
 * counts, and its key metrics. An area whose sources failed says so.
 */
export function AreasTable({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  // A source missing from the report failed this round, as the snapshot's
  // assembly treats it; only a source reported ok has data.
  const reportedOk = new Set(
    snapshot.sources
      .filter((status) => status.ok)
      .map((status) => status.source),
  );
  const rows = snapshot.sections.map((section) => ({
    section,
    counts: areaCounts(section),
    failed: section.sources.filter((source) => !reportedOk.has(source)),
  }));
  const maxIssues = Math.max(0, ...rows.map((row) => row.counts.issues));
  const needAttention = rows.filter((row) =>
    isAttention(row.section.severity),
  ).length;
  return (
    <section className="home-section" aria-label="Areas">
      <header className="ui-section-head">
        <h2 className="ui-section-title">Areas</h2>
        <span className="ui-count">
          {needAttention} of {rows.length} need attention
        </span>
      </header>
      <div className="ui-table-scroll">
        <table className="ui-table areas-table" aria-label="Areas">
          <thead>
            <tr>
              <th scope="col">Area</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                Issues
              </th>
              <th scope="col" className="num">
                Informational
              </th>
              <th scope="col" className="num">
                Waiting on you
              </th>
              <th scope="col">Key metrics</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ section, counts, failed: failedSources }) => {
              const page = SECTION_PAGES[section.id];
              return (
                <tr
                  key={section.id}
                  className="area-row"
                  data-sev={section.severity}
                >
                  <th scope="row" className="area-name">
                    {page === undefined ? (
                      section.title
                    ) : (
                      <Link to={page}>{section.title}</Link>
                    )}
                    {failedSources.length === 0 ? null : (
                      <span className="area-note">
                        no data from {failedSources.join(", ")}
                      </span>
                    )}
                  </th>
                  <td>
                    <StatusGlyph severity={section.severity} />
                  </td>
                  <IssuesCell
                    count={counts.issues}
                    max={maxIssues}
                    severity={section.severity}
                    area={section.title}
                  />
                  <CountCell count={counts.informational} />
                  <CountCell count={counts.waiting} />
                  <td className="area-metrics">
                    {section.metrics.map((metric) => (
                      <MetricChip key={metric.id} metric={metric} />
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
