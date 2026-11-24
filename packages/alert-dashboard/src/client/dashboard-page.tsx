import { Loaded } from "@shepherdjerred/loaded";
import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

import { AlertTable } from "./alert-table.tsx";
import { StaleNotice } from "./stale-notice.tsx";
import { age } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Button } from "#components/button";
import { Input } from "#components/input";
import {
  AlertListInputSchema,
  LifecycleStateSchema,
  SeveritySchema,
  SuppressionStateSchema,
  type AlertScope,
  type AlertView,
  type Summary,
} from "#shared/schema";

const WATCHDOG_ALERTNAME = "Watchdog";

export function isWatchdogForcedByFilters(params: URLSearchParams): boolean {
  if (params.get("severity") === "unknown") return true;
  const search = (params.get("q") ?? "").trim().toLowerCase();
  return search.includes("watchdog");
}

export function shouldShowWatchdog(params: URLSearchParams): boolean {
  return params.get("watchdog") === "1" || isWatchdogForcedByFilters(params);
}

export function filterWatchdogAlerts(
  alerts: readonly AlertView[],
  params: URLSearchParams,
): {
  visibleAlerts: readonly AlertView[];
  watchdogCount: number;
  showWatchdog: boolean;
} {
  const watchdogCount = alerts.filter(
    (alert) => alert.alertname === WATCHDOG_ALERTNAME,
  ).length;
  const showWatchdog = shouldShowWatchdog(params);
  const visibleAlerts = showWatchdog
    ? alerts
    : alerts.filter((alert) => alert.alertname !== WATCHDOG_ALERTNAME);
  return { visibleAlerts, watchdogCount, showWatchdog };
}

export function watchdogToggleLabel(
  showWatchdog: boolean,
  watchdogCount: number,
): string {
  const suffix = watchdogCount > 0 ? ` (${String(watchdogCount)})` : "";
  return showWatchdog ? `Hide Watchdog${suffix}` : `Show Watchdog${suffix}`;
}

function suppressionFromParam(raw: string | null): string | undefined {
  if (raw === null || raw === "") return "none";
  return raw === "all" ? undefined : raw;
}

function suppressionSelectValue(raw: string | null): string {
  return raw === null || raw === "none" ? "" : raw;
}

function scopedAlertInput(params: URLSearchParams, scope: AlertScope) {
  const search = params.get("q");
  return AlertListInputSchema.safeParse({
    limit: 100,
    scope,
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

export function SearchBox({
  initialValue,
  srLabel,
  placeholder,
  onCommit,
}: {
  readonly initialValue: string;
  readonly srLabel: string;
  readonly placeholder: string;
  readonly onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="search">
      <SearchIcon aria-hidden="true" />
      <span className="sr-only">{srLabel}</span>
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
        placeholder={placeholder}
      />
    </label>
  );
}

export function SuppressionSelect({
  params,
  update,
}: {
  readonly params: URLSearchParams;
  readonly update: (key: string, value: string) => void;
}): React.JSX.Element {
  return (
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
  );
}

export type ScopedAlertPageProps = {
  readonly scope: "ops" | "house";
  readonly documentTitle: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly errorText: string;
  readonly refreshAriaLabel: string;
  readonly headerActionsPrefix?: React.ReactNode;
  readonly summaryAriaLabel: string;
  readonly summaryGridClassName?: string;
  readonly summaryCards: (
    summary: Summary | undefined,
  ) => readonly (readonly [string, number | undefined])[];
  readonly renderFilterPrefix: (
    params: URLSearchParams,
    searchValue: string,
    update: (key: string, value: string) => void,
  ) => React.JSX.Element;
  readonly renderFilterSuffix?: (
    params: URLSearchParams,
    items: readonly AlertView[],
    update: (key: string, value: string) => void,
  ) => React.ReactNode;
  readonly loadingText: string;
  readonly loadMoreText: string;
  readonly loadingMoreText: string;
  readonly invalidFiltersText: string;
  readonly renderTable: (
    items: readonly AlertView[],
    params: URLSearchParams,
  ) => React.JSX.Element;
};

export function DashboardPage(): React.JSX.Element {
  return (
    <ScopedAlertPage
      scope="ops"
      documentTitle="Active alerts · Hub"
      eyebrow="Alertmanager ledger"
      heading="Active alerts"
      errorText="Could not load alerts."
      refreshAriaLabel="Refresh alerts"
      summaryAriaLabel="Alert summary"
      summaryCards={(summary) => [
        ["Open", summary?.open],
        ["Critical", summary?.critical],
        ["Warning", summary?.warning],
        ["Silenced", summary?.silenced],
        ["Inhibited", summary?.inhibited],
      ]}
      renderFilterPrefix={(params, searchValue, update) => (
        <>
          <SearchBox
            initialValue={searchValue}
            srLabel="Search alerts"
            placeholder="Search name, summary, fingerprint…"
            onCommit={(value) => {
              update("q", value);
            }}
          />
          <label>
            Severity
            <select
              value={params.get("severity") ?? ""}
              onChange={(event) => {
                update("severity", event.currentTarget.value);
              }}
            >
              <option value="">All</option>
              {SeveritySchema.options.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Suppression
            <SuppressionSelect params={params} update={update} />
          </label>
        </>
      )}
      renderFilterSuffix={(params, items, update) => {
        const { watchdogCount, showWatchdog } = filterWatchdogAlerts(
          items,
          params,
        );
        const forcedByFilter = isWatchdogForcedByFilters(params);
        return (
          <Button
            aria-pressed={showWatchdog}
            className="filter-action"
            disabled={forcedByFilter && params.get("watchdog") !== "1"}
            onClick={() => {
              update("watchdog", params.get("watchdog") === "1" ? "" : "1");
            }}
            type="button"
          >
            {watchdogToggleLabel(showWatchdog, watchdogCount)}
          </Button>
        );
      }}
      loadingText="Loading alerts…"
      loadMoreText="Load more alerts"
      loadingMoreText="Loading more alerts…"
      invalidFiltersText="Invalid active alert filters."
      renderTable={(items, params) => {
        const { visibleAlerts, watchdogCount, showWatchdog } =
          filterWatchdogAlerts(items, params);
        const empty =
          !showWatchdog && watchdogCount > 0
            ? `No alerts match these filters. ${String(watchdogCount)} Watchdog heartbeat hidden.`
            : "All clear — no operational alerts match these filters.";
        return <AlertTable alerts={visibleAlerts} empty={empty} />;
      }}
    />
  );
}

export function ScopedAlertPage(
  props: ScopedAlertPageProps,
): React.JSX.Element {
  const { invalidFiltersText, loadMoreText, loadingMoreText } = props;
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const locationSearch = useSyncExternalStore(
    subscribeToBrowserHistory,
    browserSearch,
    emptySearch,
  );
  const searchValue = new URLSearchParams(locationSearch).get("q") ?? "";
  const input = scopedAlertInput(params, props.scope);
  const summary = useQuery(
    trpc.summary.get.queryOptions({ scope: props.scope }),
  );
  const alerts = useInfiniteQuery(
    trpc.alerts.list.infiniteQueryOptions(
      input.success ? input.data : skipToken,
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  // The page renders its shell immediately and fills values in as they arrive,
  // so the two dependencies stay separate for display. A dependency that failed
  // but still holds cached data is `degraded`, not `error`, so a failed refresh
  // never blanks the page.
  const summaryValue = Loaded.fromQuery(summary, ["summary"]);
  const alertsValue = Loaded.fromQuery(alerts, ["alerts"]);
  const page = Loaded.all({ summary: summaryValue, alerts: alertsValue });
  const summaryData = Loaded.getOrElse(summaryValue, undefined);
  const items = Loaded.getOrElse(
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
  const refetchAll = (): void => {
    void Promise.all([summary.refetch(), alerts.refetch()]);
  };
  if (page.status === "error") {
    return (
      <main>
        <div className="error-state">
          {props.errorText} <Button onClick={refetchAll}>Retry</Button>
        </div>
      </main>
    );
  }
  const refreshButton = (
    <Button aria-label={props.refreshAriaLabel} onClick={refetchAll}>
      <RefreshCwIcon aria-hidden="true" /> Refresh
    </Button>
  );
  return (
    <main>
      <title>{props.documentTitle}</title>
      <StaleNotice errors={page.status === "degraded" ? page.errors : []} />
      <div className="page-heading">
        <div>
          <p className="eyebrow">{props.eyebrow}</p>
          <h1>{props.heading}</h1>
          <p>Last reconciled {age(summaryData?.lastReconciledAt ?? null)}</p>
        </div>
        {props.headerActionsPrefix === undefined ? (
          refreshButton
        ) : (
          <div className="heading-actions">
            {props.headerActionsPrefix}
            {refreshButton}
          </div>
        )}
      </div>
      <section
        className={props.summaryGridClassName ?? "summary-grid"}
        aria-label={props.summaryAriaLabel}
      >
        {props.summaryCards(summaryData).map(([label, value = "—"]) => (
          <div className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="filters">
          {props.renderFilterPrefix(params, searchValue, update)}
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
          {props.renderFilterSuffix?.(params, items, update)}
        </div>
        {input.success ? (
          alertsValue.status === "loading" ? (
            <div className="loading-state">{props.loadingText}</div>
          ) : (
            <>
              {props.renderTable(items, params)}
              {alerts.hasNextPage ? (
                <div className="history-pagination">
                  <Button
                    disabled={alerts.isFetchingNextPage}
                    onClick={() => {
                      void alerts.fetchNextPage();
                    }}
                    type="button"
                  >
                    {alerts.isFetchingNextPage ? loadingMoreText : loadMoreText}
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : (
          <div className="error-state">{invalidFiltersText}</div>
        )}
      </section>
    </main>
  );
}
