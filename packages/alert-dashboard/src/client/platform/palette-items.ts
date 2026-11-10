import { SearchIcon, TerminalIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  ModuleCommandContext,
  ModuleRegistry,
  ModuleSearchResult,
} from "./module.ts";

export type PaletteItem = {
  /** Unique across the whole palette; also the option's DOM id suffix. */
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon: LucideIcon;
  readonly run: (context: ModuleCommandContext) => void | Promise<void>;
};

export type PaletteSection = {
  readonly heading: string;
  readonly items: readonly PaletteItem[];
};

export type ModuleSearchResults = {
  readonly moduleId: string;
  readonly results: readonly ModuleSearchResult[];
};

function matches(query: string, words: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" || words.some((word) => word.toLowerCase().includes(needle))
  );
}

function searchSections(
  searched: readonly ModuleSearchResults[],
): PaletteSection[] {
  const groups = new Map<string, PaletteItem[]>();
  for (const { moduleId, results } of searched) {
    for (const result of results) {
      const items = groups.get(result.group) ?? [];
      items.push({
        id: `search:${moduleId}:${result.id}`,
        label: result.label,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
        icon: SearchIcon,
        run: ({ navigate }) => {
          navigate(result.to);
        },
      });
      groups.set(result.group, items);
    }
  }
  return [...groups].map(([heading, items]) => ({ heading, items }));
}

/**
 * Everything the palette lists for a query, in display order: search results
 * first, because a typed query is most likely a lookup, then the pages and
 * commands whose label or keywords match. Empty sections are left out.
 */
export function paletteSections(
  registry: ModuleRegistry,
  query: string,
  searched: readonly ModuleSearchResults[],
): PaletteSection[] {
  const pages: PaletteItem[] = registry.nav
    .filter((item) => matches(query, [item.label, `Go to ${item.label}`]))
    .map((item) => ({
      id: `page:${item.to}`,
      label: `Go to ${item.label}`,
      icon: item.icon,
      run: ({ navigate }) => {
        navigate(item.to);
      },
    }));
  const commands: PaletteItem[] = registry.modules.flatMap((module) =>
    (module.commands ?? [])
      .filter((command) =>
        matches(query, [command.label, ...(command.keywords ?? [])]),
      )
      .map((command) => ({
        id: `command:${module.id}:${command.id}`,
        label: command.label,
        icon: command.icon ?? TerminalIcon,
        run: command.run,
      })),
  );
  return [
    ...searchSections(searched),
    { heading: "Pages", items: pages },
    { heading: "Commands", items: commands },
  ].filter((section) => section.items.length > 0);
}

/** The modules that can search, so the palette knows whether to ask at all. */
export function searchableModules(registry: ModuleRegistry) {
  return registry.modules.flatMap((module) =>
    module.search === undefined
      ? []
      : [{ id: module.id, search: module.search }],
  );
}
