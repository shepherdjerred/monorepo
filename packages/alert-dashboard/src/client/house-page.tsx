import { HistoryIcon } from "lucide-react";
import { Link } from "react-router";

import { AlertStateAndOpenedCells } from "./alert-table.tsx";
import {
  figure,
  ScopedAlertPage,
  SearchBox,
  SuppressionSelect,
  ToolbarSelect,
} from "./dashboard-page.tsx";
import type { AlertView } from "#shared/schema";
import { ChorePriority } from "./ledger-severity.tsx";

export function houseDeviceArea(
  labels: Readonly<Record<string, string>>,
): string {
  return (
    labels["device"] ??
    labels["vacuum"] ??
    labels["room"] ??
    labels["entity_id"] ??
    labels["service"] ??
    "Home"
  );
}

export function HouseTable({
  alerts,
  empty = "All caught up — nothing around the house needs attention.",
}: {
  readonly alerts: readonly AlertView[];
  readonly empty?: string;
}): React.JSX.Element {
  if (alerts.length === 0) return <div className="empty-state">{empty}</div>;
  return (
    <div className="ledger-table-wrap">
      <table className="ui-table ledger-table" aria-label="House chores">
        <thead>
          <tr>
            <th scope="col">Priority</th>
            <th scope="col">Chore / Item</th>
            <th scope="col">Device / Area</th>
            <th scope="col">State</th>
            <th scope="col">Opened</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.id}>
              <td data-label="Priority">
                <ChorePriority severity={alert.severity} />
              </td>
              <td data-label="Chore / Item">
                <Link className="alert-link" to={`/alerts/${alert.id}`}>
                  <strong>{alert.summary}</strong>
                  <span className="mono">{alert.alertname}</span>
                </Link>
              </td>
              <td data-label="Device / Area">
                {houseDeviceArea(alert.labels)}
              </td>
              <AlertStateAndOpenedCells alert={alert} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HousePage(): React.JSX.Element {
  return (
    <ScopedAlertPage
      scope="house"
      documentTitle="House · Hub"
      context="Home & pet care"
      heading="House"
      errorText="Could not load house chores."
      refreshAriaLabel="Refresh chores"
      headerActionsPrefix={
        <Link className="ui-btn" to="/history?scope=house">
          <HistoryIcon aria-hidden="true" /> Chore history
        </Link>
      }
      summaryAriaLabel="House summary"
      summaryCards={(summary) => [
        figure("Open chores", summary?.open),
        figure("Urgent", summary?.critical, "warning"),
        figure("Routine", summary?.warning),
        figure("Silenced", summary?.silenced),
      ]}
      renderFilterPrefix={(params, searchValue, update) => (
        <>
          <SearchBox
            initialValue={searchValue}
            srLabel="Search chores"
            placeholder="Search chore, device, item…"
            onCommit={(value) => {
              update("q", value);
            }}
          />
          <ToolbarSelect label="Priority">
            <select
              value={params.get("severity") ?? ""}
              onChange={(event) => {
                update("severity", event.currentTarget.value);
              }}
            >
              <option value="">All</option>
              <option value="critical">urgent</option>
              <option value="warning">chore</option>
            </select>
          </ToolbarSelect>
          <ToolbarSelect label="Suppression">
            <SuppressionSelect params={params} update={update} />
          </ToolbarSelect>
        </>
      )}
      loadingText="Loading chores…"
      loadMoreText="Load more chores"
      loadingMoreText="Loading more chores…"
      invalidFiltersText="Invalid house chore filters."
      renderTable={(items) => <HouseTable alerts={items} />}
    />
  );
}
