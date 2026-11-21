import { Loaded } from "@shepherdjerred/loaded";
import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { HistoryIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";

import { StaleNotice } from "./stale-notice.tsx";
import { age, formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Button } from "#components/button";
import { Input } from "#components/input";
import {
  AlertListInputSchema,
  LifecycleStateSchema,
  SuppressionStateSchema,
  type AlertView,
} from "#shared/schema";

function suppressionFromParam(raw: string | null): string | undefined {
  if (raw === null || raw === "") return "none";
  return raw === "all" ? undefined : raw;
}

function suppressionSelectValue(raw: string | null): string {
  return raw === null || raw === "none" ? "" : raw;
}

function houseInput(params: URLSearchParams) {
  const search = params.get("q");
  return AlertListInputSchema.safeParse({
    limit: 100,
    scope: "house",
    severity: params.get("severity") ?? undefined,
    suppressionState: suppressionFromParam(params.get("suppression")),
    lifecycleState: params.get("state") ?? "open",
    search: search === null || search === "" ? undefined : search,
  });
}

function withUpdatedParam(
  params: URLSearchParams,
  key: string,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === "") next.delete(key);
  else next.set(key, value);
  return next;
}

function subscribeToBrowserHistory(onChange: () => void): () => void {
  globalThis.addEventListener("popstate", onChange);
  return () => {
    globalThis.removeEventListener("popstate", onChange);
  };
}

function browserSearch(): string {
  return globalThis.location.search;
}

function emptySearch(): string {
  return "";
}

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

function priorityLabel(severity: AlertView["severity"]): string {
  if (severity === "critical") return "urgent";
  return severity === "warning" ? "chore" : severity;
}

function priorityClass(severity: AlertView["severity"]): string {
  if (severity === "critical") return "priority priority-urgent";
  return severity === "warning"
    ? "priority priority-chore"
    : `severity severity-${severity}`;
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
    <div className="table-wrap">
      <table>
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
                <span className={priorityClass(alert.severity)}>
                  {priorityLabel(alert.severity)}
                </span>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChoreSearch({
  initialValue,
  onCommit,
}: {
  readonly initialValue: string;
  readonly onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="search">
      <SearchIcon aria-hidden="true" />
      <span className="sr-only">Search chores</span>
      <Input
        value={draft ?? initialValue}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            setDraft(null);
            onCommit(event.currentTarget.value);
          }
        }}
        placeholder="Search chore, device, item…"
      />
    </label>
  );
}

export function HousePage(): React.JSX.Element {
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const locationSearch = useSyncExternalStore(
    subscribeToBrowserHistory,
    browserSearch,
    emptySearch,
  );
  const searchValue = new URLSearchParams(locationSearch).get("q") ?? "";
  const input = houseInput(params);
  const summary = useQuery(trpc.summary.get.queryOptions({ scope: "house" }));
  const alerts = useInfiniteQuery(
    trpc.alerts.list.infiniteQueryOptions(
      input.success ? input.data : skipToken,
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  const summaryValue = Loaded.fromQuery(summary, ["summary"]);
  const alertsValue = Loaded.fromQuery(alerts, ["alerts"]);
  const page = Loaded.all({ summary: summaryValue, alerts: alertsValue });
  const summaryData = Loaded.getOrElse(summaryValue, undefined);
  const choreItems = Loaded.getOrElse(
    Loaded.map(alertsValue, (data) =>
      data.pages.flatMap((entry) => entry.items),
    ),
    [],
  );
  const update = (key: string, value: string): void => {
    setParams(withUpdatedParam(params, key, value), {
      flushSync: true,
      replace: false,
    });
  };
  if (page.status === "error")
    return (
      <main>
        <div className="error-state">
          Could not load house chores.{" "}
          <Button
            onClick={() =>
              void Promise.all([summary.refetch(), alerts.refetch()])
            }
          >
            Retry
          </Button>
        </div>
      </main>
    );
  return (
    <main>
      <title>House · Hub</title>
      <StaleNotice errors={page.status === "degraded" ? page.errors : []} />
      <div className="page-heading">
        <div>
          <p className="eyebrow">Home &amp; pet care</p>
          <h1>House</h1>
          <p>Last reconciled {age(summaryData?.lastReconciledAt ?? null)}</p>
        </div>
        <div className="heading-actions">
          <Link className="button" to="/history?scope=house">
            <HistoryIcon aria-hidden="true" /> Chore history
          </Link>
          <Button
            aria-label="Refresh chores"
            onClick={() =>
              void Promise.all([summary.refetch(), alerts.refetch()])
            }
          >
            <RefreshCwIcon aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>
      <section
        className="summary-grid summary-grid-4"
        aria-label="House summary"
      >
        {[
          ["Open chores", summaryData?.open],
          ["Urgent", summaryData?.critical],
          ["Routine", summaryData?.warning],
          ["Silenced", summaryData?.silenced],
        ].map(([label, value = "—"]) => (
          <div className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="filters">
          <ChoreSearch
            initialValue={searchValue}
            onCommit={(value) => {
              update("q", value);
            }}
          />
          <label>
            Priority
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
          </label>
          <label>
            Suppression
            <select
              value={suppressionSelectValue(params.get("suppression"))}
              onChange={(event) => {
                update("suppression", event.currentTarget.value);
              }}
            >
              <option value="">Active (unsuppressed)</option>
              <option value="all">All</option>
              {SuppressionStateSchema.options
                .filter((value) => value !== "none")
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
          </label>
          <label>
            State
            <select
              value={params.get("state") ?? "open"}
              onChange={(event) => {
                update("state", event.currentTarget.value);
              }}
            >
              {LifecycleStateSchema.options.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {input.success ? (
          alertsValue.status === "loading" ? (
            <div className="loading-state">Loading chores…</div>
          ) : (
            <>
              <HouseTable alerts={choreItems} />
              {alerts.hasNextPage ? (
                <div className="history-pagination">
                  <Button
                    disabled={alerts.isFetchingNextPage}
                    onClick={() => {
                      void alerts.fetchNextPage();
                    }}
                    type="button"
                  >
                    {alerts.isFetchingNextPage
                      ? "Loading more chores…"
                      : "Load more chores"}
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : (
          <div className="error-state">Invalid house chore filters.</div>
        )}
      </section>
    </main>
  );
}
