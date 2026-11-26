import {
  CommandPalette as ConsolePalette,
  CommandPaletteSearch,
  createCommandPaletteStore,
} from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { paletteSections, searchableModules } from "./palette-items.ts";
import { useRegistry } from "./registry.tsx";

const SEARCH_DEBOUNCE_MS = 200;
const PALETTE_LABEL = "Search and commands";

/** Whether the palette is open; creating it binds ⌘K and Ctrl+K. */
export const paletteStore = createCommandPaletteStore();

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
    retry: false,
  });
  // Only results for the term on screen are listed. Keeping the previous
  // term's results visible would leave them first in the list, where Enter
  // would open one instead of the page or command just typed.
  const searched = term === "" ? [] : (search.data ?? []);
  return (
    <CommandPaletteSearch
      store={paletteStore}
      label={PALETTE_LABEL}
      placeholder="Search services and alerts, or type a command…"
      query={query}
      onQueryChange={setQuery}
      sections={paletteSections(registry, query, searched)}
      status={
        search.isError
          ? "Search is unavailable. Pages and commands still work."
          : term !== "" && search.isFetching
            ? "Searching…"
            : undefined
      }
      onSelect={(item) => {
        void item.run({
          navigate: (to) => {
            void navigate(to);
          },
        });
      }}
    />
  );
}

/**
 * The command palette: every module's pages, commands, and search in one
 * list, opened with ⌘K or Ctrl+K from anywhere. The body mounts with the
 * dialog, so each opening starts empty.
 */
export function CommandPalette(): React.JSX.Element {
  return (
    <ConsolePalette store={paletteStore} label={PALETTE_LABEL}>
      <PaletteBody />
    </ConsolePalette>
  );
}
