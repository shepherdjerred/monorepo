import { Temporal } from "@js-temporal/polyfill";
import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";

import { age, formatInstant } from "./time.ts";
import type { AlertView } from "#shared/schema";

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
        <span className="state">{alert.lifecycleState}</span>
        {alert.suppressionState === "none" ? null : (
          <span className="suppression">{alert.suppressionState}</span>
        )}
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

function AlertRow({ alert }: { readonly alert: AlertView }): React.JSX.Element {
  return (
    <tr>
      <td data-label="Severity">
        <span className={`severity severity-${alert.severity}`}>
          {alert.severity}
        </span>
      </td>
      <td data-label="Alert">
        <Link className="alert-link" to={`/alerts/${alert.id}`}>
          <strong>{alert.alertname}</strong>
          <span>{alert.summary}</span>
        </Link>
      </td>
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

function AlertRowsTable({
  alerts,
}: {
  readonly alerts: readonly AlertView[];
}): React.JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Alert</th>
            <th scope="col">Namespace</th>
            <th scope="col">State</th>
            <th scope="col">Opened</th>
            <th scope="col">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <AlertRow alert={alert} key={alert.id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AlertTable({
  alerts,
  empty = "No alerts match these filters.",
}: {
  readonly alerts: readonly AlertView[];
  readonly empty?: string | undefined;
}): React.JSX.Element {
  if (alerts.length === 0) return <div className="empty-state">{empty}</div>;
  const { groups, singles } = partitionAlertsByGroup(alerts);
  return (
    <>
      {groups.map((group) => (
        <details
          className="alert-group group border-b border-[var(--line-soft)]"
          key={group.alertname}
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2.5 px-3.5 py-2.5 hover:bg-[var(--row-hover)] focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-[var(--accent-ring)] [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              aria-hidden="true"
              className="text-[var(--muted)] transition-transform group-open:rotate-90"
            />
            <span className={`severity severity-${group.severity}`}>
              {group.severity}
            </span>
            <strong className="text-[0.85rem]">{group.alertname}</strong>
            <span className="count">{group.alerts.length} occurrences</span>
            <span className="mono ml-auto text-xs text-[var(--muted)]">
              newest{" "}
              <time dateTime={group.newestOpenedAt}>
                {age(group.newestOpenedAt)}
              </time>
            </span>
          </summary>
          <div className="border-t border-[var(--line-soft)] bg-[var(--panel-2)]">
            <AlertRowsTable alerts={group.alerts} />
          </div>
        </details>
      ))}
      {singles.length > 0 ? <AlertRowsTable alerts={singles} /> : null}
    </>
  );
}
