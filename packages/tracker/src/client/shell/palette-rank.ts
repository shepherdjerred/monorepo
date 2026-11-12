import type { PaletteEntry } from "./palette-steps.tsx";

const normalize = (text: string) => text.trim().toLowerCase();

/** A command the query names somewhere in its label or section. */
export function matchesEntry(entry: PaletteEntry, query: string) {
  const needle = normalize(query);
  return (
    needle === "" ||
    entry.label.toLowerCase().includes(needle) ||
    entry.section.toLowerCase().includes(needle)
  );
}

/**
 * A command whose label the query starts, or one of whose words it starts:
 * "set parent" and "parent" name "Set parent…", "arent" does not.
 */
export function namesCommand(entry: PaletteEntry, query: string) {
  const needle = normalize(query);
  const label = entry.label.toLowerCase();
  return (
    needle !== "" &&
    (label.startsWith(needle) ||
      label
        .split(/[^\p{L}\p{N}]+/u)
        .some(
          (_, index, words) =>
            index > 0 && words.slice(index).join(" ").startsWith(needle),
        ))
  );
}

/**
 * The palette's order: commands the query names come before issue results,
 * so typing a command and Enter runs it, as in Linear; weaker matches
 * follow the issues.
 */
export function rankEntries(entries: readonly PaletteEntry[], query: string) {
  const named = entries.filter((entry) => namesCommand(entry, query));
  return {
    leading: named,
    trailing: entries.filter((entry) => !named.includes(entry)),
  };
}
