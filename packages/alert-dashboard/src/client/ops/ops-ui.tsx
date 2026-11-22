import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Link as OpsLink,
  Metric,
  Section,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  InfoIcon,
  OctagonAlertIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";

import { ListToggle, useCapped } from "./capped-list.tsx";
import { isSnapshotUnavailable, snapshotQuery } from "./ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import { SEVERITY_LABEL, formatValue } from "#shared/ops-format";
import {
  SERIES_RANGES,
  type ChangeView,
  type SeriesRange,
} from "#shared/ops-schema";
import type { SnapshotResponse } from "@shepherdjerred/ops-model/snapshot.ts";

export const services = new ServiceIndex();

const SEVERITY_ICON: Record<Severity, typeof InfoIcon> = {
  ok: CircleCheckIcon,
  info: InfoIcon,
  unknown: CircleHelpIcon,
  warning: CircleAlertIcon,
  error: OctagonAlertIcon,
};

/** Severity is always an icon plus a word, never color alone. */
export function SeverityBadge({
  severity,
  large = false,
}: {
  readonly severity: Severity;
  readonly large?: boolean;
}): React.JSX.Element {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={`sev sev-${severity}${large ? " sev-large" : ""}`}>
      <Icon aria-hidden="true" />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

/**
 * A severity as an icon named for screen readers, for places too tight for a
 * `SeverityBadge`. The icon's shape differs per severity, so it never rests
 * on colour alone.
 */
export function SeverityIcon({
  severity,
  className,
}: {
  readonly severity: Severity;
  readonly className: string;
}): React.JSX.Element {
  const Icon = SEVERITY_ICON[severity];
  return (
    <>
      <Icon className={className} aria-hidden="true" />
      <span className="sr-only">{SEVERITY_LABEL[severity].toLowerCase()}</span>
    </>
  );
}

export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
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
 * One metric as a tile. A metric that needs attention carries an accent bar
 * and a corner icon with its severity in words, so it never reads as healthy
 * and never depends on colour alone. `ok` and `info` stay plain.
 */
export function MetricTile({
  metric,
}: {
  readonly metric: Metric;
}): React.JSX.Element {
  const flagged = metric.severity !== "ok" && metric.severity !== "info";
  return (
    <div className={`metric metric-${metric.severity}`}>
      <span>{metric.label}</span>
      <strong>{formatValue(metric.value, metric.unit)}</strong>
      {flagged ? (
        <SeverityIcon severity={metric.severity} className="metric-flag" />
      ) : null}
    </div>
  );
}

export function SectionCard({
  section,
  to,
}: {
  readonly section: Section;
  readonly to?: string;
}): React.JSX.Element {
  return (
    <article className={`section-card section-${section.severity}`}>
      <header>
        <h2>
          {to === undefined ? (
            section.title
          ) : (
            <Link to={to}>{section.title}</Link>
          )}
        </h2>
        <SeverityBadge severity={section.severity} />
      </header>
      <p>{section.summary}</p>
      {section.metrics.length === 0 ? null : (
        <div className="metric-row">
          {section.metrics.slice(0, 3).map((metric) => (
            <MetricTile key={metric.id} metric={metric} />
          ))}
        </div>
      )}
    </article>
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
      className={`section-summary section-${section.severity}`}
      aria-labelledby={id}
    >
      <h2 id={id}>{section.title}</h2>
      <SeverityBadge severity={section.severity} />
      <p>{section.summary}</p>
      {section.metrics.length === 0 ? null : (
        <div className="metric-row">
          {section.metrics.map((metric) => (
            <MetricTile key={metric.id} metric={metric} />
          ))}
        </div>
      )}
    </article>
  );
}

/** A severity badge beside a one-line verdict, with a line of context under it. */
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
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section className={`status-banner status-${severity}`} aria-label={label}>
      <SeverityBadge severity={severity} large />
      <div>
        <p className="status-summary">{summary}</p>
        <p className="status-meta">{children}</p>
      </div>
    </section>
  );
}

/** The latest snapshot's verdict and its age. */
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
      Snapshot generated {age(snapshot.generatedAt)}
      {snapshot.stale ? " · stale: treat green as unknown" : ""}
    </StatusBanner>
  );
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
      <ol className="change-list" id={listId}>
        {list.shown.map((change) => (
          <li key={change.id} className={`change change-${change.severity}`}>
            <span className="change-kind">{change.kind}</span>
            <div>
              <p>
                {change.url === undefined ? (
                  change.title
                ) : (
                  <a href={change.url} target="_blank" rel="noreferrer">
                    {change.title}
                  </a>
                )}
              </p>
              <div className="signal-meta">
                <time dateTime={change.occurredAt}>
                  {age(change.occurredAt)}
                </time>
                {showService && change.service !== undefined ? (
                  <ServiceLink id={change.service} />
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <ListToggle list={list} controls={listId} />
    </>
  );
}

export function RangePicker({
  value,
  onChange,
}: {
  readonly value: SeriesRange;
  readonly onChange: (range: SeriesRange) => void;
}): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label="Chart range">
      {SERIES_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          role="radio"
          aria-checked={range === value}
          onClick={() => {
            onChange(range);
          }}
        >
          {range}
        </button>
      ))}
    </div>
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
