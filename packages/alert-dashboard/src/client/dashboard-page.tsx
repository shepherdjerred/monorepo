import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

import { AlertTable } from "./alert-table.tsx";
import { age } from "./time.ts";
import { useTRPC } from "./trpc.ts";
import { Button } from "#components/button";
import { Input } from "#components/input";
import {
  AlertListInputSchema,
  LifecycleStateSchema,
  SeveritySchema,
  SuppressionStateSchema,
} from "#shared/schema";

function alertInput(params: URLSearchParams) {
  const search = params.get("q");
  return AlertListInputSchema.safeParse({
    limit: 100,
    severity: params.get("severity") ?? undefined,
    suppressionState: params.get("suppression") ?? undefined,
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

function queryFailed(...states: readonly boolean[]): boolean {
  return states.includes(true);
}

function searchParam(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
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

function AlertSearch({
  initialValue,
  onCommit,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="search">
      <SearchIcon />
      <span className="sr-only">Search alerts</span>
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
        placeholder="Search name, summary, fingerprint…"
      />
    </label>
  );
}

export function DashboardPage(): React.JSX.Element {
  const trpc = useTRPC();
  const [params, setParams] = useSearchParams();
  const locationSearch = useSyncExternalStore(
    subscribeToBrowserHistory,
    browserSearch,
    emptySearch,
  );
  const searchValue = searchParam(locationSearch);
  const input = alertInput(params);
  const summary = useQuery(trpc.summary.get.queryOptions());
  const alerts = useInfiniteQuery(
    trpc.alerts.list.infiniteQueryOptions(
      input.success ? input.data : skipToken,
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );
  const alertItems = alerts.data?.pages.flatMap((page) => page.items) ?? [];
  const update = (key: string, value: string): void => {
    setParams(withUpdatedParam(params, key, value), {
      flushSync: true,
      replace: false,
    });
  };
  if (queryFailed(summary.isError, alerts.isError))
    return (
      <main>
        <div className="error-state">
          Could not load alerts.{" "}
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
      <title>Active alerts · Alerts</title>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Alertmanager ledger</p>
          <h1>Active alerts</h1>
          <p>Last reconciled {age(summary.data?.lastReconciledAt ?? null)}</p>
        </div>
        <Button
          aria-label="Refresh alerts"
          onClick={() =>
            void Promise.all([summary.refetch(), alerts.refetch()])
          }
        >
          <RefreshCwIcon /> Refresh
        </Button>
      </div>
      <section className="summary-grid" aria-label="Alert summary">
        {[
          ["Open", summary.data?.open],
          ["Critical", summary.data?.critical],
          ["Warning", summary.data?.warning],
          ["Silenced", summary.data?.silenced],
          ["Inhibited", summary.data?.inhibited],
        ].map(([label, value]) => (
          <div className="summary-card" key={label}>
            <span>{label}</span>
            <strong>{value ?? "—"}</strong>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="filters">
          <AlertSearch
            initialValue={searchValue}
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
            <select
              value={params.get("suppression") ?? ""}
              onChange={(event) => {
                update("suppression", event.currentTarget.value);
              }}
            >
              <option value="">All</option>
              {SuppressionStateSchema.options.map((value) => (
                <option key={value}>{value}</option>
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
          alerts.isPending ? (
            <div className="loading-state">Loading alerts…</div>
          ) : (
            <>
              <AlertTable alerts={alertItems} />
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
                      ? "Loading more alerts…"
                      : "Load more alerts"}
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : (
          <div className="error-state">Invalid active alert filters.</div>
        )}
      </section>
    </main>
  );
}
