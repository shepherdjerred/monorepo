import { Loaded } from "@shepherdjerred/loaded";
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";

import { StaleNotice } from "./stale-notice.tsx";
import { formatInstant } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Button } from "#components/button";
import { Input } from "#components/input";
import {
  AlertEventTypeSchema,
  EventListInputSchema,
  SeveritySchema,
} from "#shared/schema";

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
    <div className="filters history-filters">
      <label>
        Event
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
      <label>
        Severity
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
      <label>
        From
        <Input
          defaultValue={params.get("from") ?? ""}
          key={`from-${params.get("from") ?? ""}`}
          onBlur={(event) => {
            onUpdate("from", event.currentTarget.value);
          }}
          placeholder="2026-08-03T00:00:00Z"
        />
      </label>
      <label>
        To
        <Input
          defaultValue={params.get("to") ?? ""}
          key={`to-${params.get("to") ?? ""}`}
          onBlur={(event) => {
            onUpdate("to", event.currentTarget.value);
          }}
          placeholder="2026-08-10T00:00:00Z"
        />
      </label>
      <label>
        Alert name
        <Input
          value={params.get("alertname") ?? ""}
          onChange={(event) => {
            onUpdate("alertname", event.currentTarget.value);
          }}
        />
      </label>
      <label>
        Namespace
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
    <main>
      <title>History · Hub</title>
      <StaleNotice
        errors={eventsValue.status === "degraded" ? eventsValue.errors : []}
      />
      <div className="page-heading">
        <div>
          <p className="eyebrow">Durable lifecycle ledger</p>
          <h1>History</h1>
          <p>
            Filter opening, resolution, suppression, and reconciliation events
            over any RFC 3339 range.
          </p>
        </div>
      </div>
      <section className="panel">
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
              <div className="timeline">
                {eventItems.map((event) => (
                  <article key={event.id}>
                    <span className="timeline-dot" />
                    <div>
                      <div className="timeline-title">
                        <span
                          className={`severity severity-${event.alert.severity}`}
                        >
                          {event.alert.severity}
                        </span>
                        <strong>{event.type.replaceAll("_", " ")}</strong>
                        <Link to={`/alerts/${event.occurrenceId}`}>
                          {event.alert.alertname}
                        </Link>
                      </div>
                      <p>{event.alert.summary}</p>
                      <time className="mono" dateTime={event.occurredAt}>
                        {formatInstant(event.occurredAt)}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
              {events.hasNextPage ? (
                <div className="history-pagination">
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
