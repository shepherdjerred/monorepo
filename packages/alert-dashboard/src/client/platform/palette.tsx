import { Dialog } from "@base-ui/react/dialog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CornerDownLeftIcon, SearchIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import {
  paletteSections,
  searchableModules,
  type PaletteItem,
} from "./palette-items.ts";
import { useRegistry } from "./registry.tsx";

const SEARCH_DEBOUNCE_MS = 200;
const LISTBOX_ID = "palette-listbox";

// Whether the palette is open lives outside React so the global shortcut can
// toggle it without an effect, the same way the theme store works.
let paletteOpen = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPaletteOpen(next: boolean): void {
  if (paletteOpen === next) return;
  paletteOpen = next;
  for (const listener of listeners) listener();
}

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "k") return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
    return;
  event.preventDefault();
  setPaletteOpen(!paletteOpen);
});

function optionId(index: number): string {
  return `palette-option-${String(index)}`;
}

/**
 * Resolves after `delayMs`, or rejects as soon as the signal aborts. Search
 * waits on it first: the query client aborts a superseded query, so only the
 * query the user paused on reaches a module's search.
 */
function debounce(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Superseded by a newer query", "AbortError"));
      },
      { once: true },
    );
  });
}

function PaletteBody(): React.JSX.Element {
  const registry = useRegistry();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const term = query.trim();
  const searchers = searchableModules(registry);
  const search = useQuery({
    queryKey: ["palette-search", term],
    queryFn: async ({ signal }) => {
      await debounce(SEARCH_DEBOUNCE_MS, signal);
      return Promise.all(
        searchers.map(async (module) => ({
          moduleId: module.id,
          results: await module.search(term, signal),
        })),
      );
    },
    enabled: term !== "" && searchers.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  // Results belong to a query; an emptied input shows none, even while the
  // previous ones are still cached.
  const searched = term === "" ? [] : (search.data ?? []);
  const sections = paletteSections(registry, query, searched);
  const items = sections.flatMap((section) => section.items);
  const active = Math.min(selected, items.length - 1);

  function choose(item: PaletteItem | undefined): void {
    if (item === undefined) return;
    setPaletteOpen(false);
    // Run after the dialog has closed and returned focus, so a navigation is
    // not fought by the focus restore.
    requestAnimationFrame(() => {
      void item.run({
        navigate: (to) => {
          void navigate(to);
        },
      });
    });
  }

  function move(step: 1 | -1): void {
    if (items.length === 0) return;
    const next = (active + step + items.length) % items.length;
    setSelected(next);
    document
      .querySelector(`#${optionId(next)}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: React.KeyboardEvent): void {
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
    }
  }

  // Each section's first option index in the flat, keyboard-ordered list.
  const starts = sections.map((_, sectionIndex) =>
    sections
      .slice(0, sectionIndex)
      .reduce((count, section) => count + section.items.length, 0),
  );
  return (
    <>
      <div className="palette-search">
        <SearchIcon aria-hidden="true" />
        <input
          role="combobox"
          aria-label="Search and commands"
          aria-expanded="true"
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          {...(items.length === 0
            ? {}
            : { "aria-activedescendant": optionId(active) })}
          placeholder="Search services and alerts, or type a command…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="palette-results" id={LISTBOX_ID} role="listbox">
        {sections.map((section, sectionIndex) => (
          <div key={section.heading} role="group" aria-label={section.heading}>
            <p className="palette-heading" aria-hidden="true">
              {section.heading}
            </p>
            {section.items.map((item, position) => {
              const itemIndex = (starts[sectionIndex] ?? 0) + position;
              return (
                <button
                  key={item.id}
                  id={optionId(itemIndex)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={itemIndex === active}
                  className="palette-option"
                  onMouseMove={() => {
                    setSelected(itemIndex);
                  }}
                  onClick={() => {
                    choose(item);
                  }}
                >
                  <item.icon aria-hidden="true" />
                  <span className="palette-label">{item.label}</span>
                  {item.detail === undefined ? null : (
                    <span className="palette-detail">{item.detail}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <p className="palette-status" role="status">
          {search.isError
            ? "Search is unavailable. Pages and commands still work."
            : term !== "" && search.isFetching
              ? "Searching…"
              : items.length === 0
                ? "No results."
                : ""}
        </p>
      </div>
      <div className="palette-footer" aria-hidden="true">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>
            <CornerDownLeftIcon />
          </kbd>{" "}
          open
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </>
  );
}

/**
 * The command palette: every module's pages, commands, and search in one
 * list, opened with ⌘K or Ctrl+K from anywhere. The body mounts with the
 * dialog, so each opening starts empty.
 */
export function CommandPalette(): React.JSX.Element {
  const open = useSyncExternalStore(subscribe, () => paletteOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="palette-backdrop" />
        <Dialog.Popup className="palette">
          <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
          <PaletteBody />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
