import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Link as OpsLink,
  Metric,
  Section,
} from "@shepherdjerred/ops-model/snapshot.ts";
import {
  FigureStrip,
  HeaderBar,
  StatusGlyph,
  Tabs,
} from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ExternalLinkIcon,
  MinusIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";

import { ListToggle, useCapped } from "./capped-list.tsx";
import { isSnapshotUnavailable, snapshotQuery } from "./ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import { formatDelta, formatValue, trendDelta } from "#shared/ops-format";
import {
  SERIES_RANGES,
  type ChangeView,
  type DigestReport,
  type SeriesRange,
  type Trend,
} from "#shared/ops-schema";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";

export const services = new ServiceIndex();

/**
 * The page's header: console-ui's 48px `HeaderBar` across the top of the
 * panel, with the page title as its `<h1>`, an optional muted meta line, and
 * the page's controls (range tabs, buttons, its verdict) at the far right.
 */
export function PageHeading({
  title,
  tabs,
  meta,
  children,
}: {
  readonly title: string;
  /** View tabs right after the title, such as Home's attention filter. */
  readonly tabs?: ReactNode;
  readonly meta?: ReactNode;
  /** Controls for the far right of the bar. */
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="page-head">
      <HeaderBar
        title={title}
        {...(tabs === undefined ? {} : { tabs })}
        {...(meta === undefined ? {} : { meta })}
        {...(children === undefined ? {} : { actions: children })}
      />
    </div>
  );
}

export function ExternalLink({
  link,
  className,
}: {
  readonly link: OpsLink;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <a className={className} href={link.url} target="_blank" rel="noreferrer">
      {link.label}
      <ExternalLinkIcon aria-hidden="true" />
    </a>
  );
}

export function ServiceLink({
  id,
}: {
  readonly id: string;
}): React.JSX.Element {
  const service = services.byId(id);
  return (
    <Link className="chip service-chip" to={`/services/${id}`}>
      {service?.title ?? id}
    </Link>
  );
}

/**
 * One metric as a figure cell of a `MetricStrip`: its label, then the figure
 * in mono. A metric that needs attention colours its figure and adds a glyph
 * with its severity in words, so it never depends on colour alone. `ok` and
 * `info` stay plain.
 */
export function MetricTile({
  metric,
}: {
  readonly metric: Metric;
}): React.JSX.Element {
  const flagged = metric.severity !== "ok" && metric.severity !== "info";
  return (
    <div className="metric" data-sev={metric.severity}>
      <dt className="ui-strip-label">{metric.label}</dt>
      <dd className="ui-strip-value">
        <span className="ui-strip-figure">
          {formatValue(metric.value, metric.unit)}
        </span>
        {flagged ? <StatusGlyph severity={metric.severity} /> : null}
      </dd>
    </div>
  );
}

/**
 * Metrics as one description list of figure cells separated by hairlines,
 * wrapping onto as many rows as the width needs.
 */
export function MetricStrip({
  metrics,
}: {
  readonly metrics: readonly Metric[];
}): React.JSX.Element {
  return (
    <dl className="metric-row">
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} />
      ))}
    </dl>
  );
}

/** One section at a glance: its verdict, its summary and every metric. */
export function SectionSummary({
  section,
  headingId,
}: {
  readonly section: Section;
  readonly headingId?: string;
}): React.JSX.Element {
  const id = headingId ?? `summary-${section.id}`;
  return (
    <article
      className="section-summary"
      data-sev={section.severity}
      aria-labelledby={id}
    >
      <h2 id={id}>{section.title}</h2>
      <StatusGlyph severity={section.severity} />
      <p>{section.summary}</p>
      {section.metrics.length === 0 ? null : (
        <MetricStrip metrics={section.metrics} />
      )}
    </article>
  );
}

/**
 * A verdict as one quiet row: the severity glyph and word, the one-line
 * summary, and a muted line of context after it.
 */
export function StatusBanner({
  severity,
  summary,
  label,
  children,
}: {
  readonly severity: Severity;
  readonly summary: string;
  /** Names the region for assistive technology. */
  readonly label: string;
  /** The meta line: what the verdict covers or how old it is. */
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="status-banner" data-sev={severity} aria-label={label}>
      <StatusGlyph severity={severity} />
      <p className="status-summary">{summary}</p>
      {children === undefined ? null : (
        <p className="status-meta">{children}</p>
      )}
    </section>
  );
}

/**
 * The latest snapshot's verdict. Its age is in the page header; a stale
 * snapshot also says so here, beside the verdict it qualifies.
 */
export function SnapshotStatusBanner({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  return (
    <StatusBanner
      severity={snapshot.severity}
      summary={snapshot.summary}
      label="Overall status"
    >
      {snapshot.stale ? "Stale: treat green as unknown" : undefined}
    </StatusBanner>
  );
}

/** "Snapshot generated 2m ago", for a page header's meta line. */
export function SnapshotAge({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  return <>Snapshot generated {age(snapshot.generatedAt)}</>;
}

/** Changes a timeline shows before the rest sit behind "Show N more". */
const CHANGE_CAP = 15;

/** A newest-first list of changes, capped like every other ops list. */
export function ChangeTimeline({
  changes,
  showService = true,
  cap = CHANGE_CAP,
}: {
  readonly changes: readonly ChangeView[];
  readonly showService?: boolean;
  readonly cap?: number;
}): React.JSX.Element {
  const listId = useId();
  const list = useCapped(changes, cap);
  if (changes.length === 0)
    return <p className="list-empty">No changes recorded.</p>;
  return (
    <>
      <div className="ui-table-scroll">
        <table
          className="ui-table change-list"
          id={listId}
          aria-label="Changes"
        >
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Kind</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {list.shown.map((change) => (
              <tr key={change.id} className="change" data-sev={change.severity}>
                <td className="num change-when">
                  <time dateTime={change.occurredAt}>
                    {age(change.occurredAt)}
                  </time>
                </td>
                <td>
                  <span className="change-kind">{change.kind}</span>
                </td>
                <th scope="row" className="change-title">
                  {change.url === undefined ? (
                    change.title
                  ) : (
                    <a href={change.url} target="_blank" rel="noreferrer">
                      {change.title}
                    </a>
                  )}
                  {showService && change.service !== undefined ? (
                    <ServiceLink id={change.service} />
                  ) : null}
                </th>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListToggle list={list} controls={listId} />
    </>
  );
}

const RANGE_OPTIONS = SERIES_RANGES.map((range) => ({
  value: range,
  label: range,
}));

/** The chart range, as console-ui's underlined tabs (a radio group). */
export function RangePicker({
  value,
  onChange,
}: {
  readonly value: SeriesRange;
  readonly onChange: (range: SeriesRange) => void;
}): React.JSX.Element {
  return (
    <Tabs
      label="Chart range"
      options={RANGE_OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * Loads the latest snapshot and hands it to its children. Before the first
 * ingest it explains that instead of showing an error.
 */
export function SnapshotBlock({
  title,
  children,
}: {
  readonly title: string;
  readonly children: (snapshot: SnapshotResponse) => ReactNode;
}): React.JSX.Element {
  const snapshot = Loaded.fromQuery(useQuery(snapshotQuery()));
  return (
    <LoadingBlock
      values={{ snapshot }}
      fallback={<div className="loading-state">Loading {title}…</div>}
      renderError={(errors) =>
        isSnapshotUnavailable(errors[0].error) ? (
          <div className="empty-state">
            No ops snapshot has been ingested yet. The Temporal ops-snapshot
            workflow posts one every five minutes.
          </div>
        ) : (
          <div className="error-state">The ops snapshot is unavailable.</div>
        )
      }
    >
      {({ snapshot: value }, meta) => (
        <>
          <StaleNotice errors={meta.errors} />
          {children(value)}
        </>
      )}
    </LoadingBlock>
  );
}

/** A whole page that renders from the latest snapshot. */
export function WithSnapshot({
  title,
  children,
}: {
  readonly title: string;
  readonly children: (snapshot: SnapshotResponse) => ReactNode;
}): React.JSX.Element {
  return (
    <main>
      <title>{`${title} · Hub`}</title>
      <SnapshotBlock title={title}>{children}</SnapshotBlock>
    </main>
  );
}

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
export function TrendPanel({
  trends,
  headingId = "trends-heading",
}: {
  readonly trends: readonly Trend[];
  readonly headingId?: string;
}): React.JSX.Element {
  return (
    <section className="panel" aria-labelledby={headingId}>
      <header className="panel-heading">
        <h2 id={headingId}>Compared with the previous week</h2>
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

export function IncidentPanel({
  incidents,
  headingId = "incident-heading",
}: {
  readonly incidents: DigestReport["incidents"];
  readonly headingId?: string;
}): React.JSX.Element {
  return (
    <section className="panel incident-panel" aria-labelledby={headingId}>
      <header className="panel-heading">
        <h2 id={headingId}>Incidents</h2>
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
