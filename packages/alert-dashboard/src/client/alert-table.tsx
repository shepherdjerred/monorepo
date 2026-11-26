import { Temporal } from "@js-temporal/polyfill";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { age, formatInstant } from "./time.ts";
import type { AlertView } from "#shared/schema";
import { AlertSeverity, LEDGER_TONE } from "./ledger-severity.tsx";
import { bucketBySeverity } from "./severity-buckets.ts";

const SEVERITY_RANK: Record<AlertView["severity"], number> = {
  critical: 4,
  warning: 3,
  info: 2,
  unknown: 1,
};

export type AlertNameGroup = {
  alertname: string;
  severity: AlertView["severity"];
  newestOpenedAt: AlertView["openedAt"];
  alerts: readonly AlertView[];
};

export function AlertStateAndOpenedCells({
  alert,
}: {
  readonly alert: AlertView;
}): React.JSX.Element {
  return (
    <>
      <td data-label="State">
        <span className="state-chips">
          <span className="state">{alert.lifecycleState}</span>
          {alert.suppressionState === "none" ? null : (
            <span className="suppression">{alert.suppressionState}</span>
          )}
        </span>
      </td>
      <td className="mono" data-label="Opened">
        <time dateTime={alert.openedAt}>{formatInstant(alert.openedAt)}</time>
      </td>
    </>
  );
}

function summarizeAlertGroup(
  alertname: string,
  first: AlertView,
  items: readonly AlertView[],
): AlertNameGroup {
  let highestSeverity = first.severity;
  let newestOpenedAt = first.openedAt;
  for (const item of items.slice(1)) {
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[highestSeverity])
      highestSeverity = item.severity;
    if (
      Temporal.Instant.compare(
        Temporal.Instant.from(item.openedAt),
        Temporal.Instant.from(newestOpenedAt),
      ) > 0
    )
      newestOpenedAt = item.openedAt;
  }
  return {
    alertname,
    severity: highestSeverity,
    newestOpenedAt,
    alerts: items,
  };
}

export function partitionAlertsByGroup(alerts: readonly AlertView[]): {
  groups: readonly AlertNameGroup[];
  singles: readonly AlertView[];
} {
  const byName = new Map<string, AlertView[]>();
  for (const alert of alerts) {
    const existing = byName.get(alert.alertname);
    if (existing === undefined) byName.set(alert.alertname, [alert]);
    else existing.push(alert);
  }
  const groups: AlertNameGroup[] = [];
  const singles: AlertView[] = [];
  for (const [alertname, items] of byName) {
    const first = items[0];
    if (first === undefined) continue;
    if (items.length < 2) singles.push(first);
    else groups.push(summarizeAlertGroup(alertname, first, items));
  }
  return { groups, singles };
}

const COLUMNS = ["Alert", "Namespace", "State", "Opened", "Last seen"] as const;

/**
 * One alert as a row: its glyph, its name linking to the detail page with
 * the summary muted under it, then where it fires, its state and its times.
 * `data-label` names each cell for the card layout at phone width.
 */
function AlertRow({
  alert,
  memberOf,
  hidden = false,
}: {
  readonly alert: AlertView;
  /** The group row this alert sits under, when it is one of several. */
  readonly memberOf?: string;
  readonly hidden?: boolean;
}): React.JSX.Element {
  return (
    <tr
      className={
        memberOf === undefined ? "alert-row" : "alert-row ui-table-child"
      }
      data-alert-id={alert.id}
      data-sev={LEDGER_TONE[alert.severity]}
      {...(memberOf === undefined ? {} : { "data-member-of": memberOf })}
      hidden={hidden}
    >
      <th scope="row" className="ui-lead alert-cell" data-label="Alert">
        <span className="alert-line">
          <AlertSeverity severity={alert.severity} hideLabel />
          <Link className="alert-link" to={`/alerts/${alert.id}`}>
            <strong>{alert.alertname}</strong>
            <span>{alert.summary}</span>
          </Link>
        </span>
      </th>
      <td className="mono" data-label="Namespace">
        {alert.namespace ?? "—"}
      </td>
      <AlertStateAndOpenedCells alert={alert} />
      <td className="mono" data-label="Last seen">
        <time dateTime={alert.lastSeenAt}>
          {formatInstant(alert.lastSeenAt)}
        </time>
      </td>
    </tr>
  );
}

function groupNamespaces(group: AlertNameGroup): string {
  const namespaces = new Set(
    group.alerts.map((alert) => alert.namespace ?? "—"),
  );
  const [only] = namespaces;
  return only !== undefined && namespaces.size === 1
    ? only
    : `${String(namespaces.size)} namespaces`;
}

/**
 * Alerts sharing an alertname as one row whose name is the disclosure
 * button, with every occurrence as a row under it. The occurrences stay in
 * the table while closed (hidden), like the `<details>` they replace.
 */
function AlertGroupRows({
  group,
}: {
  readonly group: AlertNameGroup;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const groupId = `group-${group.alertname}`;
  return (
    <>
      <tr
        className="alert-group"
        data-group={groupId}
        data-sev={LEDGER_TONE[group.severity]}
      >
        <th scope="row" className="ui-lead alert-cell" data-label="Alert">
          <span className="alert-line">
            <AlertSeverity severity={group.severity} hideLabel />
            <button
              type="button"
              className="alert-group-toggle"
              aria-expanded={open}
              onClick={() => {
                setOpen((value) => !value);
              }}
            >
              <ChevronRightIcon
                aria-hidden="true"
                className="alert-group-chevron"
              />
              <strong className="alert-group-name">{group.alertname}</strong>
              <span className="ui-count">
                {group.alerts.length} occurrences
              </span>
            </button>
          </span>
        </th>
        <td className="mono" data-label="Namespace">
          {groupNamespaces(group)}
        </td>
        <td data-label="State" />
        <td className="mono" data-label="Opened">
          <span>
            newest{" "}
            <time dateTime={group.newestOpenedAt}>
              {age(group.newestOpenedAt)}
            </time>
          </span>
        </td>
        <td data-label="Last seen" />
      </tr>
      {group.alerts.map((alert) => (
        <AlertRow
          alert={alert}
          key={alert.id}
          memberOf={groupId}
          hidden={!open}
        />
      ))}
    </>
  );
}

type Entry =
  | { readonly type: "alert"; readonly alert: AlertView }
  | { readonly type: "group"; readonly group: AlertNameGroup };

function entrySeverity(entry: Entry): AlertView["severity"] {
  return entry.type === "alert" ? entry.alert.severity : entry.group.severity;
}

function entryCount(entry: Entry): number {
  return entry.type === "alert" ? 1 : entry.group.alerts.length;
}

/** Groups and single alerts under one heading row per severity, worst first. */
function bySeverity(
  groups: readonly AlertNameGroup[],
  singles: readonly AlertView[],
): [AlertView["severity"], Entry[]][] {
  const entries: Entry[] = [
    ...groups.map((group) => ({ type: "group" as const, group })),
    ...singles.map((alert) => ({ type: "alert" as const, alert })),
  ];
  return bucketBySeverity(
    entries,
    entrySeverity,
    (severity) => SEVERITY_RANK[severity],
  );
}

/**
 * The ledger's alerts as one table under a heading row per severity
 * ("Critical 1"). Alerts that share an alertname collapse into one
 * disclosure row with each occurrence under it.
 */
export function AlertTable({
  alerts,
  empty = "No alerts match these filters.",
  label = "Alerts",
}: {
  readonly alerts: readonly AlertView[];
  readonly empty?: string | undefined;
  readonly label?: string;
}): React.JSX.Element {
  if (alerts.length === 0) return <div className="empty-state">{empty}</div>;
  const { groups, singles } = partitionAlertsByGroup(alerts);
  return (
    <div className="ledger-table-wrap">
      <table className="ui-table ledger-table" aria-label={label}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        {bySeverity(groups, singles).map(([severity, bucket]) => (
          <tbody key={severity} data-sev={LEDGER_TONE[severity]}>
            <tr className="ui-table-group">
              <th scope="rowgroup" colSpan={COLUMNS.length}>
                <AlertSeverity severity={severity} />
                <span className="ui-count">
                  {bucket.reduce((sum, entry) => sum + entryCount(entry), 0)}
                </span>
              </th>
            </tr>
            {bucket.map((entry) =>
              entry.type === "alert" ? (
                <AlertRow alert={entry.alert} key={entry.alert.id} />
              ) : (
                <AlertGroupRows
                  group={entry.group}
                  key={entry.group.alertname}
                />
              ),
            )}
          </tbody>
        ))}
      </table>
    </div>
  );
}
