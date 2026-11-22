import { Button } from "@shepherdjerred/console-ui";
import { Loaded } from "@shepherdjerred/loaded";
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { StaleNotice } from "./stale-notice.tsx";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Input } from "#components/input";
import {
  AlertEventTypeSchema,
  EventListInputSchema,
  SeveritySchema,
} from "#shared/schema";
import { AlertSeverity, LEDGER_TONE } from "./ledger-severity.tsx";
import { PageHeading } from "./ops/ops-ui.tsx";

const SCOPE_OPTIONS = [
  ["ops", "Ops"],
  ["house", "House"],
  ["all", "All"],
] as const;

export const HISTORY_FILTER_KEYS = [
  "type",
  "severity",
  "from",
  "to",
  "alertname",
  "namespace",
] as const;

function nonEmptyParam(
  params: URLSearchParams,
  key: string,
): string | undefined {
  const value = params.get(key);
  return value === null || value === "" ? undefined : value;
}

export function hasActiveHistoryFilters(params: URLSearchParams): boolean {
  return HISTORY_FILTER_KEYS.some(
    (key) => nonEmptyParam(params, key) !== undefined,
  );
}

export function clearHistoryFilterParams(
  params: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of HISTORY_FILTER_KEYS) next.delete(key);
  return next;
}

export function historyInput(params: URLSearchParams) {
  const rawScope = params.get("scope");
  return EventListInputSchema.safeParse({
    limit: 100,
    scope: rawScope === null || rawScope === "" ? "ops" : rawScope,
    type: nonEmptyParam(params, "type"),
    severity: nonEmptyParam(params, "severity"),
    from: nonEmptyParam(params, "from"),
    to: nonEmptyParam(params, "to"),
    alertname: nonEmptyParam(params, "alertname"),
    namespace: nonEmptyParam(params, "namespace"),
  });
}

function scopeHref(params: URLSearchParams, scope: string): string {
  const next = new URLSearchParams(params);
  next.set("scope", scope);
  return `/history?${next.toString()}`;
}

export function HistoryFilters({
  params,
  onUpdate,
  onClear,
}: {
  readonly params: URLSearchParams;
  readonly onUpdate: (key: string, value: string) => void;
  readonly onClear: () => void;
}): React.JSX.Element {
  const filtered = hasActiveHistoryFilters(params);
  return (
    <div className="ui-toolbar ledger-toolbar history-filters">
      <label className="toolbar-field">
        <span className="toolbar-field-label">Event</span>
        <select
          value={params.get("type") ?? ""}
          onChange={(event) => {
            onUpdate("type", event.currentTarget.value);
          }}
        >
          <option value="">All</option>
          {AlertEventTypeSchema.options.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="toolbar-field">
        <span className="toolbar-field-label">Severity</span>
        <select
          value={params.get("severity") ?? ""}
          onChange={(event) => {
            onUpdate("severity", event.currentTarget.value);
          }}
        >
          <option value="">All</option>
          {SeveritySchema.options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="toolbar-field">
        <span className="toolbar-field-label">From</span>
        <Input
          defaultValue={params.get("from") ?? ""}
          key={`from-${params.get("from") ?? ""}`}
          onBlur={(event) => {
            onUpdate("from", event.currentTarget.value);
          }}
          placeholder="2026-08-03T00:00:00Z"
        />
      </label>
      <label className="toolbar-field">
        <span className="toolbar-field-label">To</span>
        <Input
          defaultValue={params.get("to") ?? ""}
          key={`to-${params.get("to") ?? ""}`}
          onBlur={(event) => {
            onUpdate("to", event.currentTarget.value);
          }}
          placeholder="2026-08-10T00:00:00Z"
        />
      </label>
      <label className="toolbar-field">
        <span className="toolbar-field-label">Alert name</span>
        <Input
          value={params.get("alertname") ?? ""}
          onChange={(event) => {
            onUpdate("alertname", event.currentTarget.value);
          }}
        />
      </label>
      <label className="toolbar-field">
        <span className="toolbar-field-label">Namespace</span>
        <Input
          value={params.get("namespace") ?? ""}
          onChange={(event) => {
            onUpdate("namespace", event.currentTarget.value);
          }}
        />
      </label>
      {filtered ? (
        <Button className="filter-action" onClick={onClear} type="button">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

export function HistoryPage(): React.JSX.Element {
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const rawScope = params.get("scope");
  const activeScope = rawScope === null || rawScope === "" ? "ops" : rawScope;
  const input = historyInput(params);
  const events = useInfiniteQuery(
    trpc.events.list.infiniteQueryOptions(
      input.success ? input.data : skipToken,
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );
  const eventsValue = Loaded.fromQuery(events, ["events"]);
  const eventItems = Loaded.getOrElse(
    Loaded.map(eventsValue, (data) => data.pages.flatMap((page) => page.items)),
    [],
  );
  const update = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  return (
    <main className="ledger">
      <title>History · Hub</title>
      <StaleNotice
        errors={eventsValue.status === "degraded" ? eventsValue.errors : []}
      />
      <PageHeading
        title="History"
        meta="Opening, resolution, suppression and reconciliation events"
      />
      <section className="ledger-list" aria-label="History list">
        <nav className="scope-switch" aria-label="History scope">
          {SCOPE_OPTIONS.map(([scope, label]) => (
            <Link
              key={scope}
              to={scopeHref(params, scope)}
              aria-current={activeScope === scope ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <HistoryFilters
          onClear={() => {
            setParams(clearHistoryFilterParams(params));
          }}
          onUpdate={update}
          params={params}
        />
        {input.success ? (
          eventsValue.status === "error" ? (
            <div className="error-state">History is unavailable.</div>
          ) : eventsValue.status === "loading" ? (
            <div className="loading-state">Loading history…</div>
          ) : eventItems.length === 0 ? (
            <div className="empty-state">
              No lifecycle events match this range.
            </div>
          ) : (
            <>
              <div className="ledger-table-wrap">
                <table className="ui-table ledger-table" aria-label="Events">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Event</th>
                      <th scope="col">Alert</th>
                      <th scope="col">Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventItems.map((event) => (
                      <tr
                        key={event.id}
                        className="history-event"
                        data-sev={LEDGER_TONE[event.alert.severity]}
                      >
                        <td className="mono" data-label="When">
                          <time dateTime={event.occurredAt}>
                            {formatInstant(event.occurredAt)}
                          </time>
                        </td>
                        <td data-label="Severity">
                          <AlertSeverity severity={event.alert.severity} />
                        </td>
                        <td data-label="Event">
                          {event.type.replaceAll("_", " ")}
                        </td>
                        <th scope="row" data-label="Alert">
                          <Link to={`/alerts/${event.occurrenceId}`}>
                            {event.alert.alertname}
                          </Link>
                        </th>
                        <td className="history-summary" data-label="Summary">
                          {event.alert.summary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {events.hasNextPage ? (
                <div className="ui-section-foot">
                  <Button
                    disabled={events.isFetchingNextPage}
                    onClick={() => {
                      void events.fetchNextPage();
                    }}
                    type="button"
                  >
                    {events.isFetchingNextPage
                      ? "Loading older events…"
                      : "Load older events"}
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : (
          <div className="error-state">Invalid history filters.</div>
        )}
      </section>
    </main>
  );
}
