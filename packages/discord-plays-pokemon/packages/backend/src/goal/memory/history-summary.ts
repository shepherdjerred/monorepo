// Pure formatter: CompletedGoal[] → multi-line human-readable text that the
// model reads via `pokemonctl history --limit N`. Kept short so a 3-entry
// history doesn't blow out the goal-mode prompt budget.

import type { CompletedGoal } from "#src/goal/goal-history.ts";

const REPORT_SNIPPET_LIMIT = 280;

export function formatHistoryForPrompt(
  entries: readonly CompletedGoal[],
): string {
  return entries.length === 0
    ? "No completed goals yet this session."
    : entries.map((entry, index) => formatEntry(entry, index)).join("\n\n");
}

function formatEntry(entry: CompletedGoal, index: number): string {
  const header = `[${String(index + 1)}] (${entry.status}) ${entry.goal}`;
  const when = `  started ${entry.startedAt}, finished ${entry.finishedAt}`;
  const report =
    entry.finalReport === undefined || entry.finalReport.length === 0
      ? "  (no final report)"
      : `  report: ${snippet(entry.finalReport)}`;
  return [header, when, report].join("\n");
}

function snippet(value: string): string {
  const flattened = value.replaceAll(/\s+/g, " ").trim();
  return flattened.length <= REPORT_SNIPPET_LIMIT
    ? flattened
    : `${flattened.slice(0, REPORT_SNIPPET_LIMIT)}…`;
}
