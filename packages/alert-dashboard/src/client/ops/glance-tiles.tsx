import {
  findSection,
  needsMeSignals,
} from "@shepherdjerred/ops-model/assemble.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type {
  Section,
  SnapshotResponse,
} from "@shepherdjerred/ops-model/snapshot.ts";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";

import { WAITING_PATH } from "./attention-filter.ts";
import { showAttentionPanel } from "./attention-panel.tsx";
import {
  firingAlertSignals,
  firingAlertsHint,
  firingAlertsSeverity,
  waitingSeverity,
} from "./home-signals.ts";
import { SeverityBadge } from "./ops-ui.tsx";
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
  readonly target:
    | { readonly to: string; readonly onClick?: () => void }
    | { readonly href: string };
}): React.JSX.Element {
  const external = "href" in target;
  const content = (
    <>
      <span className="stat-label">
        {label}
        {external ? (
          <ExternalLinkIcon className="stat-external" aria-hidden="true" />
        ) : null}
      </span>
      <SeverityBadge severity={severity} />
      <strong>{value}</strong>
      <span className="stat-hint">{hint}</span>
    </>
  );
  return (
    <li className={`stat-card stat-${severity}`}>
      {external ? (
        <a href={target.href} target="_blank" rel="noreferrer">
          {content}
        </a>
      ) : (
        <Link to={target.to} onClick={target.onClick}>
          {content}
        </Link>
      )}
    </li>
  );
}

/**
 * The three numbers Home leads with. Each tile states its severity as a
 * badge as well as a border colour, and links to where the number is acted on.
 */
export function GlanceTiles({
  snapshot,
}: {
  readonly snapshot: SnapshotResponse;
}): React.JSX.Element {
  const alerts = findSection(snapshot, "alerts");
  const firing = reading(alerts, METRIC_IDS.alertsFiring);
  const critical = reading(alerts, METRIC_IDS.alertsCritical);
  const needsMe = needsMeSignals(snapshot);
  const triage = reading(
    findSection(snapshot, "work"),
    METRIC_IDS.trackerTriage,
  );
  return (
    <ul className="stat-grid" aria-label="At a glance">
      <Stat
        label="Firing alerts"
        value={firing.text}
        severity={firingAlertsSeverity(firing.severity, alerts)}
        hint={firingAlertsHint(
          firingAlertSignals(alerts).length,
          critical.text,
        )}
        target={{ to: "/alerts" }}
      />
      <Stat
        label="Waiting on you"
        value={String(needsMe.length)}
        severity={waitingSeverity(needsMe)}
        hint="Next action is yours"
        target={{ to: WAITING_PATH, onClick: showAttentionPanel }}
      />
      <Stat
        label="Tracker triage"
        value={triage.text}
        severity={triage.severity}
        hint="Issues to triage"
        target={{ href: APP_HOSTS.tracker }}
      />
    </ul>
  );
}
