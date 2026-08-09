import { Link } from "react-router";

import { formatInstant } from "./time.ts";
import type { AlertView } from "#shared/schema";

export function AlertTable({
  alerts,
  empty = "No alerts match these filters.",
}: {
  alerts: readonly AlertView[];
  empty?: string;
}): React.JSX.Element {
  if (alerts.length === 0) return <div className="empty-state">{empty}</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Alert</th>
            <th>Namespace</th>
            <th>State</th>
            <th>Opened</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
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
              <td data-label="State">
                <span className="state">{alert.lifecycleState}</span>
                {alert.suppressionState === "none" ? null : (
                  <span className="suppression">{alert.suppressionState}</span>
                )}
              </td>
              <td className="mono" data-label="Opened">
                <time dateTime={alert.openedAt}>
                  {formatInstant(alert.openedAt)}
                </time>
              </td>
              <td className="mono" data-label="Last seen">
                <time dateTime={alert.lastSeenAt}>
                  {formatInstant(alert.lastSeenAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
