import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Field,
  FigureStrip,
  Meter,
  ShellFrame,
  type Figure,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { fetchCatalogSummary } from "./api.ts";
import { ChartsTable } from "./charts-table.tsx";
import {
  buildSearchSuffix,
  computeCatalogCounts,
  filterCharts,
  formatBytes,
  isEditableElement,
  latestBuildSummary,
  parseUrlState,
  quotaMeterState,
  type CatalogCounts,
  type CatalogFilter,
  type CatalogSummary,
  type ChartSummaryItem,
} from "./model.ts";
import { ChartsHeader, ChartsSidebar, MobileBar } from "./shell.tsx";

function buildFigures(
  summary: CatalogSummary | null,
  counts: CatalogCounts,
): readonly Figure[] {
  if (summary === null) {
    return [
      { label: "Charts", value: "—" },
      { label: "Releases", value: "—" },
      { label: "Latest build", value: "—" },
      { label: "Storage", value: "—" },
    ];
  }
  const latestBuild = latestBuildSummary(summary.charts);
  const quota = quotaMeterState(summary.totalBytes, summary.quotaBytes);
  return [
    {
      label: "Charts",
      value: summary.chartCount,
      hint: `${String(counts["first-party"])} first-party · ${String(counts.upstream)} upstream`,
    },
    {
      label: "Releases",
      value: summary.releaseCount,
      hint: "immutable archives",
    },
    {
      label: "Latest build",
      value: latestBuild.version,
      ...(latestBuild.hint === undefined ? {} : { hint: latestBuild.hint }),
    },
    {
      label: "Storage",
      value: formatBytes(summary.totalBytes),
      hint: `of ${formatBytes(summary.quotaBytes)}`,
      severity: quota.severity,
    },
  ];
}

function CatalogBody({
  loadError,
  isInitialLoading,
  totalCount,
  shown,
  query,
  expandedNames,
  onToggleExpand,
  onRetry,
}: {
  readonly loadError: string | null;
  readonly isInitialLoading: boolean;
  readonly totalCount: number;
  readonly shown: readonly ChartSummaryItem[];
  readonly query: string;
  readonly expandedNames: ReadonlySet<string>;
  readonly onToggleExpand: (name: string) => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (loadError !== null) {
    return (
      <div className="ch-banner" data-sev="error" role="alert">
        <span>Unable to load chart catalog: {loadError}</span>
        <button type="button" className="ui-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (isInitialLoading) {
    return (
      <p className="ch-empty ui-muted" role="status" aria-live="polite">
        Loading Helm chart catalog…
      </p>
    );
  }
  if (totalCount === 0) {
    return (
      <p className="ch-empty ui-muted">
        No Helm charts have been published to this repository yet.
      </p>
    );
  }
  if (shown.length === 0) {
    const trimmed = query.trim();
    return (
      <p className="ch-empty ui-muted">
        No charts match the active filter
        {trimmed === "" ? "." : ` “${trimmed}”.`}
      </p>
    );
  }
  return (
    <ChartsTable
      charts={shown}
      expandedNames={expandedNames}
      onToggleExpand={onToggleExpand}
    />
  );
}

export function CatalogWorkspace({
  summary,
  loadError,
  isInitialLoading,
  query,
  filter,
  expandedNames,
  theme,
  searchInputRef,
  onQueryChange,
  onFilterChange,
  onToggleExpand,
  onRetry,
}: {
  readonly summary: CatalogSummary | null;
  readonly loadError: string | null;
  readonly isInitialLoading: boolean;
  readonly query: string;
  readonly filter: CatalogFilter;
  readonly expandedNames: ReadonlySet<string>;
  readonly theme: ThemeStore;
  readonly searchInputRef?: React.RefObject<HTMLInputElement | null>;
  readonly onQueryChange: (next: string) => void;
  readonly onFilterChange: (next: CatalogFilter) => void;
  readonly onToggleExpand: (name: string) => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const charts = useMemo(() => summary?.charts ?? [], [summary]);
  const counts = useMemo(() => computeCatalogCounts(charts), [charts]);
  const shown = useMemo(
    () => filterCharts(charts, filter, query),
    [charts, filter, query],
  );
  const figures = useMemo(
    () => buildFigures(summary, counts),
    [counts, summary],
  );
  const quota =
    summary === null
      ? null
      : quotaMeterState(summary.totalBytes, summary.quotaBytes);

  return (
    <ShellFrame
      sidebar={
        <ChartsSidebar
          counts={counts}
          filter={filter}
          theme={theme}
          onFilterChange={onFilterChange}
        />
      }
    >
      <MobileBar
        filter={filter}
        counts={counts}
        theme={theme}
        onFilterChange={onFilterChange}
      />

      <ChartsHeader catalogRevision={summary?.catalogRevision ?? null} />

      <main className="ch-main">
        <FigureStrip figures={figures} />

        <div className="ui-toolbar ch-toolbar">
          <search aria-label="Filter charts" className="ch-search">
            <form
              action="/"
              method="get"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <Field label="Search" layout="inline">
                {(control) => (
                  <input
                    {...control}
                    ref={searchInputRef}
                    name="q"
                    type="search"
                    value={query}
                    placeholder="Chart, version or digest (/)"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={(event) => {
                      onQueryChange(event.target.value);
                    }}
                  />
                )}
              </Field>
            </form>
          </search>

          {summary === null ? null : (
            <span className="ui-count" aria-live="polite">
              {String(shown.length)} of {String(charts.length)} charts
            </span>
          )}

          {summary === null || quota === null ? null : (
            <div className="ch-quota-meter">
              <span className="ui-muted">Quota</span>
              <Meter
                value={summary.totalBytes}
                max={summary.quotaBytes}
                severity={quota.severity}
                label="Chart storage quota"
                text={quota.percentText}
              />
            </div>
          )}
        </div>

        <CatalogBody
          loadError={loadError}
          isInitialLoading={isInitialLoading}
          totalCount={charts.length}
          shown={shown}
          query={query}
          expandedNames={expandedNames}
          onToggleExpand={onToggleExpand}
          onRetry={onRetry}
        />
      </main>
    </ShellFrame>
  );
}

export function App({
  theme,
}: {
  readonly theme: ThemeStore;
}): React.JSX.Element {
  const initialUrl = useMemo(
    () => parseUrlState(globalThis.location.search),
    [],
  );

  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState(initialUrl.query);
  const [filter, setFilter] = useState<CatalogFilter>(initialUrl.filter);
  const [expandedNames, setExpandedNames] = useState<ReadonlySet<string>>(
    initialUrl.expanded,
  );

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const syncUrl = useCallback(
    (nextQuery: string, nextFilter: CatalogFilter) => {
      const suffix = buildSearchSuffix({
        query: nextQuery,
        filter: nextFilter,
        fixture: initialUrl.fixture,
      });
      globalThis.history.replaceState(
        null,
        "",
        `${globalThis.location.pathname}${suffix}`,
      );
    },
    [initialUrl.fixture],
  );

  const loadCatalog = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const result = await fetchCatalogSummary(initialUrl.fixture, signal);
        setSummary(result);
        setIsLoading(false);
      } catch (error) {
        if (signal?.aborted === true) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Request failed");
        setIsLoading(false);
      }
    },
    [initialUrl.fixture],
  );

  const rootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        return;
      }
      const controller = new AbortController();
      void loadCatalog(controller.signal);
      return () => {
        controller.abort();
      };
    },
    [loadCatalog],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const ignore =
      event.key !== "/" ||
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableElement(event.target);
    if (ignore) {
      return;
    }
    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  const handleQueryChange = (next: string): void => {
    setQuery(next);
    syncUrl(next, filter);
  };

  const handleFilterChange = (next: CatalogFilter): void => {
    setFilter(next);
    syncUrl(query, next);
  };

  const handleToggleExpand = (name: string): void => {
    setExpandedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <div ref={rootRef} onKeyDownCapture={handleKeyDown}>
      <CatalogWorkspace
        summary={summary}
        loadError={loadError}
        isInitialLoading={isLoading && summary === null}
        query={query}
        filter={filter}
        expandedNames={expandedNames}
        theme={theme}
        searchInputRef={searchInputRef}
        onQueryChange={handleQueryChange}
        onFilterChange={handleFilterChange}
        onToggleExpand={handleToggleExpand}
        onRetry={() => {
          setIsLoading(true);
          void loadCatalog();
        }}
      />
    </div>
  );
}
