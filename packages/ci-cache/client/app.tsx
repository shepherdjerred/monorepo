import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ShellFrame, type ThemeStore } from "@shepherdjerred/console-ui";
import {
  DEMO_SUMMARY,
  computeNamespaceGroupCounts,
  filterEntries,
  filterNamespaces,
} from "./fixture.ts";
import {
  CacheHeader,
  MobileBar,
  NamespacesSidebar,
  parseNamespaceFilter,
} from "./shell.tsx";
import { CacheHeadline, EntriesSection, NamespacesTable } from "./tables.tsx";
import {
  SummaryResponseSchema,
  type EntryViewTab,
  type NamespaceFilter,
  type SummaryResponse,
} from "./types.ts";

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

function readInitialSearchState(): {
  isDemo: boolean;
  query: string;
  selected: NamespaceFilter;
} {
  if (!("location" in globalThis)) {
    return { isDemo: false, query: "", selected: "overview" };
  }
  const params = new URLSearchParams(globalThis.location.search);
  return {
    isDemo: params.get("fixture") === "demo",
    query: params.get("q") ?? "",
    selected: parseNamespaceFilter(params.get("ns")),
  };
}

function syncUrlState(selected: NamespaceFilter, query: string): void {
  if (!("location" in globalThis) || !("history" in globalThis)) {
    return;
  }
  const url = new URL(globalThis.location.href);
  if (selected === "overview") {
    url.searchParams.delete("ns");
  } else {
    url.searchParams.set("ns", selected);
  }
  const trimmed = query.trim();
  if (trimmed === "") {
    url.searchParams.delete("q");
  } else {
    url.searchParams.set("q", query);
  }
  globalThis.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

async function fetchSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  const init: RequestInit = { headers: { Accept: "application/json" } };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch("/api/summary", init);
  if (!response.ok) {
    throw new Error(`Summary request failed (${String(response.status)})`);
  }
  const payload: unknown = await response.json();
  return SummaryResponseSchema.parse(payload);
}

export function App({
  theme,
  initialSummary,
}: {
  theme: ThemeStore;
  initialSummary?: SummaryResponse;
}) {
  const initial = useMemo(() => readInitialSearchState(), []);
  const seeded = initialSummary ?? (initial.isDemo ? DEMO_SUMMARY : null);

  const [summary, setSummary] = useState<SummaryResponse | null>(seeded);
  const [isLoading, setIsLoading] = useState(seeded === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NamespaceFilter>(initial.selected);
  const [query, setQuery] = useState(initial.query);
  const [entryTab, setEntryTab] = useState<EntryViewTab>("largest");

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      if (initialSummary !== undefined || initial.isDemo) {
        return;
      }
      setLoadError(null);
      try {
        const next = await fetchSummary(signal);
        setSummary(next);
        setIsLoading(false);
      } catch (error) {
        if (signal?.aborted === true) {
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load CI cache summary.",
        );
        setIsLoading(false);
      }
    },
    [initial.isDemo, initialSummary],
  );

  const shellRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null || initialSummary !== undefined || initial.isDemo) {
        return;
      }
      const controller = new AbortController();
      void reload(controller.signal);
      const timer = globalThis.setInterval(() => {
        void reload(controller.signal);
      }, 15_000);
      return () => {
        controller.abort();
        globalThis.clearInterval(timer);
      };
    },
    [initial.isDemo, initialSummary, reload],
  );

  const handleSelectNamespace = (next: NamespaceFilter): void => {
    setSelected(next);
    syncUrlState(next, query);
  };

  const handleQueryChange = (next: string): void => {
    setQuery(next);
    syncUrlState(selected, next);
  };

  const handleKeyDownCapture = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    if (
      event.key !== "/" ||
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableElement(event.target)
    ) {
      return;
    }
    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  const counts = useMemo(
    () => computeNamespaceGroupCounts(summary?.namespaces ?? []),
    [summary],
  );

  const visibleNamespaces = useMemo(
    () => filterNamespaces(summary?.namespaces ?? [], selected, query),
    [query, selected, summary],
  );

  const visibleEntries = useMemo(() => {
    const sourceEntries =
      entryTab === "largest"
        ? (summary?.largestEntries ?? [])
        : (summary?.recentEntries ?? []);
    return filterEntries(sourceEntries, selected, query);
  }, [entryTab, query, selected, summary]);

  return (
    <div ref={shellRef} onKeyDownCapture={handleKeyDownCapture}>
      <ShellFrame
        sidebar={
          <NamespacesSidebar
            counts={counts}
            selected={selected}
            theme={theme}
            onSelect={handleSelectNamespace}
          />
        }
      >
        <MobileBar
          counts={counts}
          selected={selected}
          theme={theme}
          onSelect={handleSelectNamespace}
        />
        <CacheHeader
          selected={selected}
          query={query}
          searchInputRef={searchInputRef}
          onQueryChange={handleQueryChange}
        />
        <main>
          {loadError !== null && (
            <div className="ci-cache-banner" data-sev="error" role="alert">
              <span>{loadError}</span>
              <button
                type="button"
                className="ui-btn"
                onClick={() => {
                  setIsLoading(true);
                  void reload();
                }}
              >
                Retry
              </button>
            </div>
          )}

          {isLoading && summary === null ? (
            <p
              className="ci-cache-loading ui-muted"
              role="status"
              aria-live="polite"
            >
              Loading cache telemetry…
            </p>
          ) : (
            summary !== null && (
              <>
                <CacheHeadline summary={summary} />
                <NamespacesTable
                  namespaces={visibleNamespaces}
                  highWatermarkBytes={summary.highWatermarkBytes}
                  generatedAt={summary.generatedAt}
                />
                <EntriesSection
                  tab={entryTab}
                  entries={visibleEntries}
                  generatedAt={summary.generatedAt}
                  onTabChange={setEntryTab}
                />
              </>
            )
          )}
        </main>
      </ShellFrame>
    </div>
  );
}
