import {
  findSection,
  needsMeSignals,
} from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import {
  isAttention,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import type {
  Section,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";

import { SignalList, SnapshotBlock, StatusBanner } from "./ops-ui.tsx";
import { formatValue } from "#shared/ops-format";

type Reading = { readonly text: string; readonly severity: Severity };

/**
 * A headline metric as Home shows it. A source that failed emits no metric,
 * which reads as "no data" rather than as zero.
 */
function reading(section: Section, metricId: string): Reading {
  const metric = section.metrics.find((entry) => entry.id === metricId);
  return metric === undefined
    ? { text: "—", severity: "unknown" }
    : {
        text: formatValue(metric.value, metric.unit),
        severity: metric.severity,
      };
}

function Stat({
  label,
  value,
  severity,
  hint,
  target,
}: {
  readonly label: string;
  readonly value: string;
  readonly severity: Severity;
  readonly hint: string;
  /** An in-app path, or another app's URL. */
  readonly target: { readonly to: string } | { readonly href: string };
}): React.JSX.Element {
  const content = (
    <>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <span className="stat-hint">{hint}</span>
    </>
  );
  return (
    <li className={`stat-card stat-${severity}`}>
      {"to" in target ? (
        <Link to={target.to}>{content}</Link>
      ) : (
        <a href={target.href} target="_blank" rel="noreferrer">
          {content}
          <ExternalLinkIcon className="stat-external" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

function Summary({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const newIds = new Set(snapshot.newSignalIds);
  const alerts = findSection(snapshot, "alerts");
  const firing = reading(alerts, METRIC_IDS.alertsFiring);
  const critical = reading(alerts, METRIC_IDS.alertsCritical);
  const firingSignals = alerts.signals.filter((signal) =>
    isAttention(signal.severity),
  );
  const needsMe = needsMeSignals(snapshot);
  const triage = reading(
    findSection(snapshot, "work"),
    METRIC_IDS.trackerTriage,
  );
  return (
    <>
      <StatusBanner snapshot={snapshot} />
      <ul className="stat-grid" aria-label="At a glance">
        <Stat
          label="Firing alerts"
          value={firing.text}
          severity={firing.severity}
          hint={`${critical.text} critical`}
          target={{ to: "/alerts" }}
        />
        <Stat
          label="Waiting on you"
          value={String(needsMe.length)}
          severity={needsMe.length === 0 ? "ok" : "warning"}
          hint="Next action is yours"
          target={{ to: "/overview" }}
        />
        <Stat
          label="Tracker triage"
          value={triage.text}
          severity={triage.severity}
          hint="Issues to triage"
          target={{ href: APP_HOSTS.tracker }}
        />
      </ul>
      <div className="home-lists">
        <section className="panel list-panel" aria-labelledby="firing-heading">
          <header className="panel-heading">
            <h2 id="firing-heading">
              Firing alerts{" "}
              <span className="count">{firingSignals.length}</span>
            </h2>
            <Link className="panel-link" to="/alerts">
              All alerts <ArrowRightIcon aria-hidden="true" />
            </Link>
          </header>
          <SignalList
            signals={firingSignals}
            empty="No alerts are firing."
            newIds={newIds}
            limit={5}
          />
        </section>
        <section className="panel list-panel" aria-labelledby="waiting-heading">
          <header className="panel-heading">
            <h2 id="waiting-heading">
              Waiting on you <span className="count">{needsMe.length}</span>
            </h2>
            <Link className="panel-link" to="/overview">
              Overview <ArrowRightIcon aria-hidden="true" />
            </Link>
          </header>
          <SignalList
            signals={needsMe}
            empty="Nothing is waiting on you."
            newIds={newIds}
            limit={5}
          />
        </section>
      </div>
    </>
  );
}

/** The core module's Home block: status, alerts, and what waits on Jerred. */
export function OpsHomeSummary(): React.JSX.Element {
  return (
    <SnapshotBlock title="status">
      {(snapshot) => <Summary snapshot={snapshot} />}
    </SnapshotBlock>
  );
}
