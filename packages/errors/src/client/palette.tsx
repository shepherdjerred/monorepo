import { Dialog } from "@base-ui/react/dialog";
import type { ThemeStore } from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { ProjectSummary } from "#shared/contract.ts";
import { fetchIssues } from "./api.ts";
import {
  buildStaticSections,
  issueToPaletteItem,
  matchesQuery,
  type PaletteItem,
  type PaletteSection,
} from "./palette-model.ts";
import {
  themeStore as defaultThemeStore,
  useThemePreference,
} from "./theme.ts";

const SEARCH_DEBOUNCE_MS = 180;
const LISTBOX_ID = "er-palette-listbox";

let paletteOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPaletteOpen(): boolean {
  return paletteOpen;
}

function getServerPaletteOpen(): boolean {
  return false;
}

export function setPaletteOpen(next: boolean): void {
  if (paletteOpen === next) {
    return;
  }
  paletteOpen = next;
  for (const listener of listeners) {
    listener();
  }
}

export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

if (typeof document !== "undefined") {
  document.addEventListener("keydown", (event) => {
    if (!isPaletteShortcut(event)) {
      return;
    }
    event.preventDefault();
    setPaletteOpen(!paletteOpen);
  });
}

function optionId(index: number): string {
  return `er-palette-option-${String(index)}`;
}

function debounce(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("Superseded by a newer query", "AbortError"));
      },
      { once: true },
    );
  });
}

type IndexedPaletteEntry = {
  readonly item: PaletteItem;
  readonly flatIndex: number;
};

type IndexedPaletteGroup = {
  readonly heading: string;
  readonly entries: readonly IndexedPaletteEntry[];
};

function indexPaletteSections(
  sections: readonly PaletteSection[],
): readonly IndexedPaletteGroup[] {
  let cursor = 0;
  return sections.map((section) => ({
    heading: section.heading,
    entries: section.items.map((item) => {
      const entry: IndexedPaletteEntry = { item, flatIndex: cursor };
      cursor += 1;
      return entry;
    }),
  }));
}

function PaletteOptionRow({
  entry,
  selectedIndex,
  onSelectIndex,
  onPickItem,
}: {
  readonly entry: IndexedPaletteEntry;
  readonly selectedIndex: number;
  readonly onSelectIndex: (index: number) => void;
  readonly onPickItem: (item: PaletteItem) => void;
}): React.JSX.Element {
  const Glyph = entry.item.icon;
  return (
    <button
      id={optionId(entry.flatIndex)}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={entry.flatIndex === selectedIndex}
      className="palette-option"
      onMouseMove={() => {
        onSelectIndex(entry.flatIndex);
      }}
      onClick={() => {
        onPickItem(entry.item);
      }}
    >
      <Glyph aria-hidden="true" />
      <span className="palette-label">{entry.item.label}</span>
      {entry.item.detail === undefined ? null : (
        <span className="palette-detail">{entry.item.detail}</span>
      )}
    </button>
  );
}

function PaletteSearchField({
  query,
  activeDescendantId,
  onChangeQuery,
  onKeyNavigation,
}: {
  readonly query: string;
  readonly activeDescendantId?: string | undefined;
  readonly onChangeQuery: (nextQuery: string) => void;
  readonly onKeyNavigation: (event: React.KeyboardEvent) => void;
}): React.JSX.Element {
  return (
    <div className="palette-search">
      <SearchIcon aria-hidden="true" />
      <input
        role="combobox"
        aria-label="Search and commands"
        aria-expanded="true"
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId}
        placeholder="Jump to project, search issues, or run a command…"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          onChangeQuery(event.target.value);
        }}
        onKeyDown={onKeyNavigation}
      />
    </div>
  );
}

function PaletteKeyboardHints(): React.JSX.Element {
  return (
    <div className="palette-footer" aria-hidden="true">
      <span>
        <kbd>↑</kbd> <kbd>↓</kbd> navigate
      </span>
      <span>
        <kbd>
          <CornerDownLeftIcon />
        </kbd>{" "}
        select
      </span>
      <span>
        <kbd>Esc</kbd> dismiss
      </span>
    </div>
  );
}

function PaletteBody({
  projects,
  store,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly store: ThemeStore;
}): React.JSX.Element {
  const navigate = useNavigate();
  const preference = useThemePreference(store);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const term = query.trim();
  const normalizedTerm = term.toLowerCase();

  const issueSearch = useQuery({
    queryKey: ["palette-issues", term],
    queryFn: async ({ signal }) => {
      await debounce(SEARCH_DEBOUNCE_MS, signal);
      const result = await fetchIssues(
        { q: term, tab: "all", limit: 8 },
        signal,
      );
      return result.items;
    },
    enabled: term.length >= 2,
    retry: false,
  });

  const sections = useMemo(() => {
    const baseSections = buildStaticSections(projects, store, preference)
      .map((section) => ({
        heading: section.heading,
        items: section.items.filter((item) =>
          matchesQuery(item, normalizedTerm),
        ),
      }))
      .filter((section) => section.items.length > 0);

    const matchingIssues =
      term.length >= 2
        ? (issueSearch.data ?? []).map((issue) => issueToPaletteItem(issue))
        : [];
    if (matchingIssues.length === 0) {
      return baseSections;
    }
    return [
      { heading: "Matching issues", items: matchingIssues },
      ...baseSections,
    ];
  }, [issueSearch.data, normalizedTerm, preference, projects, store, term]);

  const indexedGroups = useMemo(
    () => indexPaletteSections(sections),
    [sections],
  );
  const items = sections.flatMap((section) => section.items);
  const active = items.length === 0 ? 0 : Math.min(selected, items.length - 1);

  const choose = (item: PaletteItem | undefined): void => {
    if (item === undefined) {
      return;
    }
    setPaletteOpen(false);
    globalThis.requestAnimationFrame(() => {
      item.run((to) => {
        void navigate(to);
      });
    });
  };

  const move = (step: 1 | -1): void => {
    if (items.length === 0) {
      return;
    }
    const next = (active + step + items.length) % items.length;
    setSelected(next);
    if (typeof document !== "undefined") {
      document
        .querySelector(`#${optionId(next)}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        move(1);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        move(-1);
        break;
      }
      case "Enter": {
        event.preventDefault();
        choose(items[active]);
        break;
      }
      default:
        break;
    }
  };

  const statusText =
    term.length >= 2 && issueSearch.isFetching
      ? "Searching issues…"
      : items.length === 0
        ? "No matching pages, projects, or issues."
        : "";

  return (
    <>
      <PaletteSearchField
        query={query}
        activeDescendantId={items.length === 0 ? undefined : optionId(active)}
        onChangeQuery={(nextQuery) => {
          setQuery(nextQuery);
          setSelected(0);
        }}
        onKeyNavigation={handleKeyDown}
      />
      <div className="palette-results" id={LISTBOX_ID} role="listbox">
        {indexedGroups.map((group) => (
          <div key={group.heading} role="group" aria-label={group.heading}>
            <p className="palette-heading" aria-hidden="true">
              {group.heading}
            </p>
            {group.entries.map((entry) => (
              <PaletteOptionRow
                key={entry.item.id}
                entry={entry}
                selectedIndex={active}
                onSelectIndex={setSelected}
                onPickItem={choose}
              />
            ))}
          </div>
        ))}
        <p className="palette-status" role="status">
          {statusText}
        </p>
      </div>
      <PaletteKeyboardHints />
    </>
  );
}

export function CommandPalette({
  projects,
  store = defaultThemeStore,
}: {
  readonly projects: readonly ProjectSummary[];
  readonly store?: ThemeStore | undefined;
}): React.JSX.Element {
  const isDialogOpen = useSyncExternalStore(
    subscribe,
    getPaletteOpen,
    getServerPaletteOpen,
  );
  return (
    <Dialog.Root open={isDialogOpen} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="palette-backdrop" />
        <Dialog.Popup className="palette">
          <Dialog.Title className="ui-sr-only">
            Search and commands
          </Dialog.Title>
          <PaletteBody projects={projects} store={store} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
