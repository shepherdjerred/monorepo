import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Link as OpsLink,
  Metric,
  Section,
  Signal,
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
import type { ReactNode } from "react";
import { Link } from "react-router";

import { isSnapshotUnavailable, snapshotQuery } from "./ops-api.ts";
import { StaleNotice } from "#client/stale-notice.tsx";
import { age } from "#client/time.ts";
import { SEVERITY_LABEL, formatValue } from "#shared/ops-format";
import {
  SERIES_RANGES,
  type ChangeView,
  type SeriesRange,
  type SnapshotResponse,
} from "#shared/ops-schema";

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

function SignalItem({
  signal,
  isNew,
  showService,
}: {
  readonly signal: Signal;
  readonly isNew: boolean;
  readonly showService: boolean;
}): React.JSX.Element {
  const [primary, ...rest] = signal.links;
  return (
    <li className="signal">
      <SeverityBadge severity={signal.severity} />
      <div className="signal-body">
        <p className="signal-title">
          {primary === undefined ? (
            signal.title
          ) : (
            <a href={primary.url} target="_blank" rel="noreferrer">
              {signal.title}
            </a>
          )}
          {isNew ? <span className="new-tag">New</span> : null}
        </p>
        {signal.detail === undefined ? null : (
          <p className="signal-detail">{signal.detail}</p>
        )}
        <div className="signal-meta">
          {showService && signal.service !== undefined ? (
            <ServiceLink id={signal.service} />
          ) : null}
          {signal.since === undefined ? null : (
            <span className="mono">since {age(signal.since)}</span>
          )}
          {rest.map((link) => (
            <ExternalLink className="chip" key={link.url} link={link} />
          ))}
        </div>
      </div>
    </li>
  );
}

export function SignalList({
  signals,
  empty,
  newIds,
  showService = true,
  limit,
}: {
  readonly signals: readonly Signal[];
  readonly empty: string;
  readonly newIds?: ReadonlySet<string>;
  readonly showService?: boolean;
  readonly limit?: number;
}): React.JSX.Element {
  if (signals.length === 0) return <p className="list-empty">{empty}</p>;
  const shown = limit === undefined ? signals : signals.slice(0, limit);
  return (
    <>
      <ul className="signal-list">
        {shown.map((signal) => (
          <SignalItem
            key={signal.id}
            signal={signal}
            isNew={newIds?.has(signal.id) ?? false}
            showService={showService}
          />
        ))}
      </ul>
      {shown.length < signals.length ? (
        <p className="list-more">
          {signals.length - shown.length} more not shown
        </p>
      ) : null}
    </>
  );
}

export function MetricTile({
  metric,
}: {
  readonly metric: Metric;
}): React.JSX.Element {
  return (
    <div className={`metric metric-${metric.severity}`}>
      <span>{metric.label}</span>
      <strong>{formatValue(metric.value, metric.unit)}</strong>
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

export function StatusBanner({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  return (
    <section
      className={`status-banner status-${snapshot.severity}`}
      aria-label="Overall status"
    >
      <SeverityBadge severity={snapshot.severity} large />
      <div>
        <p className="status-summary">{snapshot.summary}</p>
        <p className="status-meta">
          Snapshot generated {age(snapshot.generatedAt)}
          {snapshot.stale ? " · stale: treat green as unknown" : ""}
        </p>
      </div>
    </section>
  );
}

export function ChangeTimeline({
  changes,
  showService = true,
}: {
  readonly changes: readonly ChangeView[];
  readonly showService?: boolean;
}): React.JSX.Element {
  if (changes.length === 0)
    return <p className="list-empty">No changes recorded.</p>;
  return (
    <ol className="change-list">
      {changes.map((change) => (
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
              <time dateTime={change.occurredAt}>{age(change.occurredAt)}</time>
              {showService && change.service !== undefined ? (
                <ServiceLink id={change.service} />
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
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
 * Loads the latest snapshot and hands it to the page. Before the first
 * ingest the page explains that instead of showing an error.
 */
export function WithSnapshot({
  title,
  children,
}: {
  readonly title: string;
  readonly children: (snapshot: SnapshotResponse) => ReactNode;
}): React.JSX.Element {
  const snapshot = Loaded.fromQuery(useQuery(snapshotQuery()));
  return (
    <main>
      <title>{`${title} · Ops`}</title>
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
    </main>
  );
}
