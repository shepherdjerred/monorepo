import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type {
  TraceListItem,
  TraceRange,
  TraceSource,
  TracesFacetsResponse,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useId, useMemo } from "react";
import { useSearchParams } from "react-router";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { UrlTabBar } from "#client/ops/pages/cluster-page.tsx";
import { EngKpiStrip } from "#client/reports/reports-page.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatValue } from "#shared/ops-format";
import "#styles/engineering.css";
import "#styles/platform.css";
import "#styles/reports.css";
import "#styles/visuals.css";
import "./traces.css";

import {
  tracesFacetsQuery,
  tracesKeys,
  tracesSearchInfiniteQuery,
} from "./traces-api.ts";
import {
  ageFromEpochMs,
  ARCHIVE_RANGES,
  parseTracesUrlState,
  TEMPO_RANGES,
} from "./traces-format.ts";
import {
  TracesFilterToolbar,
  TracesResultsTable,
} from "./traces-list-sections.tsx";

const SOURCE_TABS = ["tempo", "archive"] as const;
const SOURCE_TAB_LABELS: Readonly<Record<TraceSource, string>> = {
  tempo: "Live Tempo (30d)",
  archive: "Archive index (365d)",
};

function buildTracesKpis(input: {
  readonly items: readonly TraceListItem[];
  readonly truncated: boolean;
  readonly source: TraceSource;
  readonly range: TraceRange;
  readonly facets: TracesFacetsResponse;
}): readonly {
  readonly label: string;
  readonly val: string;
  readonly hint: string;
  readonly sev: Severity;
}[] {
  const { items, truncated, source, range, facets } = input;
  const errorCount = items.filter((item) => item.errorCount > 0).length;
  let inputSum = 0;
  let cachedSum = 0;
  let outputSum = 0;
  let toolIoCount = 0;
  for (const item of items) {
    inputSum += item.inputTokens ?? 0;
    cachedSum += item.cachedInputTokens ?? 0;
    outputSum += item.outputTokens ?? 0;
    if (item.hasToolIo) toolIoCount += 1;
  }

  return [
    {
      label: "Matched traces",
      val: `${String(items.length)}${truncated ? "+" : ""}`,
      hint:
        source === "tempo"
          ? `Live Tempo · ${range} window`
          : `SeaweedFS index · ${range} window`,
      sev: "info",
    },
    {
      label: "Error traces",
      val: String(errorCount),
      hint:
        errorCount === 0
          ? "Zero errored traces in view"
          : "Traces with errored spans in view",
      sev: errorCount > 0 ? "error" : "ok",
    },
    {
      label: "Input & cache tokens",
      val: formatValue(inputSum, "tokens"),
      hint: `${formatValue(cachedSum, "tokens")} cached input read`,
      sev: "ok",
    },
    {
      label: "Output tokens",
      val: formatValue(outputSum, "tokens"),
      hint: `${String(toolIoCount)} traces with tool or command I/O`,
      sev: "ok",
    },
    {
      label: "Archive index",
      val: `${String(facets.indexedTraces)} traces`,
      hint: `${String(facets.indexedSpans)} spans · synced ${ageFromEpochMs(facets.latestWatermarkUpdatedAtMs)}`,
      sev: facets.archiveConfigured ? "ok" : "unknown",
    },
  ];
}

export function TracesListPage(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const baseId = useId();
  const tableHeadingId = `${baseId}-heading`;

  const { source, query } = useMemo(
    () => parseTracesUrlState(params),
    [params],
  );
  const facetsLoaded = Loaded.fromQuery(
    useQuery(tracesFacetsQuery(query.range)),
  );
  const searchQuery = useInfiniteQuery(tracesSearchInfiniteQuery(query));
  const searchLoaded = Loaded.fromQuery(searchQuery);

  const setParamPatch = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const selectSourceTab = useCallback(
    (nextSource: TraceSource) => {
      const next = new URLSearchParams(params);
      if (nextSource === "archive") {
        next.set("source", "archive");
        const curRange = next.get("range");
        if (curRange === null || curRange === "1h" || curRange === "6h") {
          next.set("range", "365d");
        }
      } else {
        next.delete("source");
        const curRange = next.get("range");
        if (curRange === "90d" || curRange === "365d") {
          next.set("range", "24h");
        }
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const hasActiveFilters =
    query.service !== undefined ||
    query.workload !== undefined ||
    query.provider !== undefined ||
    query.model !== undefined ||
    query.status !== "all" ||
    query.q !== undefined;

  const resetFilters = useCallback(() => {
    const next = new URLSearchParams();
    if (source === "archive") {
      next.set("source", "archive");
      next.set("range", "365d");
    }
    setParams(next, { replace: true });
  }, [source, setParams]);

  const rangeOptions = source === "archive" ? ARCHIVE_RANGES : TEMPO_RANGES;

  return (
    <main className="eng-page traces-page">
      <title>Traces · Hub</title>
      <PageHeading
        meta="LLM trajectories · Tempo &amp; SeaweedFS"
        title="Traces"
      >
        <>
          <button
            type="button"
            className="ui-btn"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: tracesKeys.all });
            }}
          >
            <RefreshCwIcon aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </>
      </PageHeading>

      <LoadingBlock
        values={{ facets: facetsLoaded, search: searchLoaded }}
        fallback={<div className="loading-state">Loading LLM traces…</div>}
        renderError={() => (
          <div className="error-state">
            LLM trace search and archive index are unavailable.
          </div>
        )}
      >
        {({ facets, search }, meta) => {
          const items = search.pages.flatMap((page) => page.items);
          const lastPage = search.pages.at(-1);
          const truncated =
            Boolean(lastPage?.truncated) || searchQuery.hasNextPage;
          const kpis = buildTracesKpis({
            items,
            truncated,
            source,
            range: query.range,
            facets,
          });

          return (
            <>
              <StaleNotice errors={meta.errors} />

              <EngKpiStrip className="traces-kpi-grid" items={kpis} />

              <UrlTabBar
                baseId={`${baseId}-source`}
                label="Trace storage source"
                tabs={SOURCE_TABS}
                labels={SOURCE_TAB_LABELS}
                active={source}
                onSelect={selectSourceTab}
              />

              <section
                className="panel traces-table-panel"
                aria-labelledby={tableHeadingId}
              >
                <div className="traces-panel-head">
                  <div>
                    <h2 className="rep-panel-title" id={tableHeadingId}>
                      {source === "tempo"
                        ? "Live Tempo LLM traces"
                        : "SeaweedFS archived LLM traces"}
                    </h2>
                    <p className="rep-panel-sub">
                      {source === "tempo"
                        ? "Full OTLP distributed traces enriched with indexed token & tool metadata."
                        : "365-day SQLite span index backed by on-demand SeaweedFS gzipped envelopes."}
                    </p>
                  </div>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      className="button rep-reset-btn"
                      onClick={resetFilters}
                    >
                      <XIcon aria-hidden="true" />
                      <span>Reset</span>
                    </button>
                  ) : null}
                </div>

                <TracesFilterToolbar
                  baseId={baseId}
                  searchText={params.get("q") ?? ""}
                  query={query}
                  rangeOptions={rangeOptions}
                  facets={facets}
                  onPatch={setParamPatch}
                />

                <TracesResultsTable
                  tableHeadingId={tableHeadingId}
                  items={items}
                />

                {searchQuery.hasNextPage ? (
                  <div className="traces-load-more">
                    <button
                      type="button"
                      className="ui-btn"
                      disabled={searchQuery.isFetchingNextPage}
                      onClick={() => {
                        void searchQuery.fetchNextPage();
                      }}
                    >
                      {searchQuery.isFetchingNextPage
                        ? "Loading more…"
                        : "Load more traces"}
                    </button>
                  </div>
                ) : null}
              </section>
            </>
          );
        }}
      </LoadingBlock>
    </main>
  );
}
