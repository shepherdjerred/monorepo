import path from "node:path";
import { defaultHistoryPaths, type HistoryPaths } from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import type { HistorySource, HistorySourceName } from "#lib/history/types.ts";

/** The registered history source with this name; a missing one fails the test. */
export function historySourceNamed(name: HistorySourceName): HistorySource {
  const found = createHistorySources().find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`${name} source is missing`);
  }
  return found;
}

/** Default history paths under `<root>/home`, with per-test overrides. */
export function historyPathsUnder(
  root: string,
  overrides: Partial<HistoryPaths>,
): HistoryPaths {
  return { ...defaultHistoryPaths(path.join(root, "home")), ...overrides };
}
