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

function historyInput(params: URLSearchParams) {
  return EventListInputSchema.safeParse({
    limit: 100,
    type: params.get("type") ?? undefined,
    severity: params.get("severity") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    alertname: params.get("alertname") ?? undefined,
    namespace: params.get("namespace") ?? undefined,
  });
}

export function HistoryPage(): React.JSX.Element {
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
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
      <title>History · Alerts</title>
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
        <div className="filters history-filters">
          <label>
            Event
            <select
              value={params.get("type") ?? ""}
              onChange={(event) => {
                update("type", event.currentTarget.value);
              }}
            >
              <option value="">All</option>
              {AlertEventTypeSchema.options.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
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
            From
            <Input
              defaultValue={params.get("from") ?? ""}
              key={`from-${params.get("from") ?? ""}`}
              onBlur={(event) => {
                update("from", event.currentTarget.value);
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
                update("to", event.currentTarget.value);
              }}
              placeholder="2026-08-10T00:00:00Z"
            />
          </label>
          <label>
            Alert name
            <Input
              value={params.get("alertname") ?? ""}
              onChange={(event) => {
                update("alertname", event.currentTarget.value);
              }}
            />
          </label>
          <label>
            Namespace
            <Input
              value={params.get("namespace") ?? ""}
              onChange={(event) => {
                update("namespace", event.currentTarget.value);
              }}
            />
          </label>
        </div>
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
