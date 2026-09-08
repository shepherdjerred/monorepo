import { ApplicationFailure } from "@temporalio/common";

/**
 * Replay-compatibility surface for `deps-summary-weekly` executions started
 * before the evidence-backed rewrite.
 *
 * Temporal compares the commands a workflow emits against its recorded
 * history. A pre-rewrite history opens with `cloneAndGetVersionChanges`, so
 * `generateDependencySummary` must still emit that sequence for those
 * executions or every workflow task fails as nondeterministic and retries
 * forever — the execution hangs until a human terminates it.
 *
 * These activities exist to preserve that sequence, not to do the work. Steps
 * the old execution already completed are replayed from history and never
 * reach this module; the first step it had not completed fails here, non
 * retryably, so the execution ends promptly and visibly (`temporal-failure-watch`
 * raises it) instead of hanging. The rewritten delivery path is not reachable
 * from the legacy command sequence, and the pre-rewrite one sent mail outside
 * the shared report sender, which `scripts/checks/check-suppressions.ts` now forbids.
 *
 * Delete this module, its worker registration, and the workflow's legacy
 * branch once no pre-rewrite execution can still be open — the schedule's
 * `workflowExecutionTimeout` is 3 hours.
 */

export type LegacyDependencyChange = {
  name: string;
  datasource: string;
  registryUrl: string | undefined;
  oldVersion: string;
  newVersion: string;
};

export type LegacyReleaseNote = {
  dependency: string;
  version: string;
  notes: string;
  url?: string;
};

export type LegacyFailedFetch = {
  dependency: string;
  version: string;
  reason: string;
};

export type LegacyReleaseNotesResult = {
  notes: LegacyReleaseNote[];
  failed: LegacyFailedFetch[];
};

function retired(activity: string): never {
  throw ApplicationFailure.nonRetryable(
    `${activity} was retired by the evidence-backed dependency summary rewrite. This execution predates the rewrite and cannot be completed on the current worker; the next scheduled run produces the report.`,
    "DepsSummaryLegacyActivityRetired",
  );
}

export type DepsSummaryLegacyActivities = typeof depsSummaryLegacyActivities;

export const depsSummaryLegacyActivities = {
  cloneAndGetVersionChanges(
    _daysBack: number,
  ): Promise<LegacyDependencyChange[]> {
    return retired("cloneAndGetVersionChanges");
  },
  fetchReleaseNotes(
    _changes: LegacyDependencyChange[],
  ): Promise<LegacyReleaseNotesResult> {
    return retired("fetchReleaseNotes");
  },
  summarizeWithLLM(
    _changes: LegacyDependencyChange[],
    _notes: LegacyReleaseNote[],
  ): Promise<string> {
    return retired("summarizeWithLLM");
  },
  formatAndSendEmail(
    _changes: LegacyDependencyChange[],
    _summary: string,
    _failed: LegacyFailedFetch[],
  ): Promise<void> {
    return retired("formatAndSendEmail");
  },
};
