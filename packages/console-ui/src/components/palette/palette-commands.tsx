import { useState } from "react";
import {
  CommandPaletteSearch,
  type CommandPaletteItem,
  type CommandPaletteSection,
  type CommandPaletteStore,
} from "@shepherdjerred/console-ui/components/command-palette.tsx";
import type { RecentCommands } from "@shepherdjerred/console-ui/components/palette/recent-commands.ts";
import { useAsyncResults } from "@shepherdjerred/console-ui/components/pickers/use-async-results.ts";

/** A palette row that runs, or steps into a nested list. */
export type PaletteCommand<Context> = CommandPaletteItem & {
  /** More words typing matches, e.g. synonyms. */
  readonly keywords?: string;
  /** Runs after the palette closes (or at once with `stay`). */
  readonly run?: (context: Context) => void;
  /** Run and keep the palette open, e.g. to toggle a label. */
  readonly stay?: boolean;
  /** Choosing it opens this nested list instead of running. */
  readonly step?: PaletteStep<Context>;
};

export type PaletteSections<Context> = readonly CommandPaletteSection<
  PaletteCommand<Context>
>[];

/**
 * Static sections, filtered by what is typed; or a function of the query
 * that returns sections already filtered (e.g. a date parsed from it).
 */
export type PaletteSource<Context> =
  PaletteSections<Context> | ((query: string) => PaletteSections<Context>);

/** Loads sections for what is typed; abort `signal` when a newer query wins. */
export type PaletteLoader<Context> = (
  query: string,
  signal: AbortSignal,
) => Promise<PaletteSections<Context>>;

export type PaletteStep<Context> = {
  /** Unique among steps; also the breadcrumb text. */
  readonly title: string;
  readonly placeholder?: string;
  readonly sections: PaletteSource<Context>;
  readonly loadSections?: PaletteLoader<Context>;
};

export type CommandPaletteCommandsProps<Context> = {
  readonly store: CommandPaletteStore;
  /** Names the search box; match the palette's `label`. */
  readonly label: string;
  readonly placeholder?: string;
  /** Passed to every `run`, e.g. `{ navigate }`. */
  readonly context: Context;
  readonly sections: PaletteSource<Context>;
  /** Server search for the top level, listed after the static sections. */
  readonly loadSections?: PaletteLoader<Context>;
  /** The wait before a load runs, in ms (180). */
  readonly debounceMs?: number;
  /** Shorter queries do not load (1). */
  readonly minQueryLength?: number;
  readonly searchingText?: string;
  readonly errorText?: string;
  /** Offers recently run commands first while nothing is typed. */
  readonly recent?: RecentCommands;
};

/** Whether every typed word is in the label, detail or keywords. */
export function matchesCommand(
  command: Pick<PaletteCommand<unknown>, "label" | "detail" | "keywords">,
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack =
    `${command.label} ${command.detail ?? ""} ${command.keywords ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function resolve<Context>(
  source: PaletteSource<Context>,
  query: string,
): PaletteSections<Context> {
  if (typeof source === "function") return source(query);
  return source
    .map((section) => ({
      heading: section.heading,
      items: section.items.filter((item) => matchesCommand(item, query)),
    }))
    .filter((section) => section.items.length > 0);
}

/** Recent commands first; they leave their usual sections meanwhile. */
function withRecent<Context>(
  sections: PaletteSections<Context>,
  ids: readonly string[],
): PaletteSections<Context> {
  const all = sections.flatMap((section) => section.items);
  const recent = ids.flatMap((id) => all.filter((item) => item.id === id));
  if (recent.length === 0) return sections;
  const shown = new Set(recent.map((item) => item.id));
  return [
    { heading: "Recent", items: recent },
    ...sections
      .map((section) => ({
        heading: section.heading,
        items: section.items.filter((item) => !shown.has(item.id)),
      }))
      .filter((section) => section.items.length > 0),
  ];
}

/**
 * A ready palette body on `CommandPaletteSearch`: static commands filtered
 * as you type, server results loaded (debounced, aborted, "Searching…"),
 * nested steps with a breadcrumb (Backspace or Escape goes back), recent
 * commands, and `run(context)` once the palette has closed.
 */
export function CommandPaletteCommands<Context>({
  store,
  label,
  placeholder,
  context,
  sections,
  loadSections,
  debounceMs = 180,
  minQueryLength = 1,
  searchingText = "Searching…",
  errorText = "Search is unavailable. Commands still work.",
  recent,
}: CommandPaletteCommandsProps<Context>): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [steps, setSteps] = useState<readonly PaletteStep<Context>[]>([]);
  const [, setRuns] = useState(0);
  const { results, request, cancel } = useAsyncResults<
    PaletteSections<Context>
  >(undefined, debounceMs);
  const step = steps.at(-1);
  const loader = step === undefined ? loadSections : step.loadSections;

  function search(next: string, using = loader): void {
    if (using === undefined || next.trim().length < minQueryLength) {
      cancel();
      return;
    }
    request(next, using);
  }

  const own = resolve(step?.sections ?? sections, query);
  const loaded =
    results.status === "done" && results.query === query ? results.value : [];
  const listed =
    step === undefined && query === "" && recent !== undefined
      ? withRecent(own, recent.ids())
      : [...own, ...loaded];
  const status =
    results.status === "loading"
      ? searchingText
      : results.status === "error"
        ? errorText
        : undefined;

  function enter(next: readonly PaletteStep<Context>[]): void {
    setSteps(next);
    setQuery("");
    cancel();
  }

  return (
    <CommandPaletteSearch
      store={store}
      label={label}
      placeholder={step?.placeholder ?? placeholder}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        search(next);
      }}
      sections={listed}
      status={status}
      breadcrumb={steps.map(({ title }) => title)}
      listKey={steps.map(({ title }) => title).join("\u0000")}
      onBack={() => {
        enter(steps.slice(0, -1));
      }}
      keepOpen={(item) => item.step !== undefined || item.stay === true}
      onSelect={(item) => {
        if (item.step !== undefined) {
          enter([...steps, item.step]);
          return;
        }
        recent?.remember(item.id);
        item.run?.(context);
        // A `stay` command changes what the rows show, e.g. a check.
        if (item.stay === true) setRuns((count) => count + 1);
      }}
    />
  );
}
