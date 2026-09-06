import { SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS } from "#shared/scout-queue-windows-lookback.ts";
import {
  BUCKET,
  type QueueWindowsReport,
} from "#activities/scout/scout-queue-windows-report.ts";

/**
 * PR body + auto-merge policy for the queue-windows watcher.
 *
 * Split out of the activity: it sits at the repo's max-lines cap, and these are
 * pure string builders that deserve tests without dragging the activity's S3,
 * GitHub, and Temporal imports into the test process.
 */

/** Auto-merge is safe only when every edit merely opens/reopens a window. A
 * close retires a live mode and must be confirmed against patch notes. */
export function canAutoMerge(
  edits: readonly QueueWindowsReport["edits"][number][],
): boolean {
  return edits.length > 0 && edits.every((edit) => edit.kind !== "close");
}

/**
 * Make a value safe to place in a markdown table cell.
 *
 * Drift messages are engine-authored prose that can legitimately contain a
 * queue name with a `/` separator (the Doom Bots trio renders as
 * `easy doom bots/normal doom bots/hard doom bots`) and, in future, anything a
 * new warning kind wants to say. A bare `|` or newline silently breaks the
 * table for every row after it.
 */
function tableCell(value: string): string {
  return value.replaceAll("|", String.raw`\|`).replaceAll(/\r?\n/g, " ");
}

export function buildPrBody(
  report: QueueWindowsReport,
  autoMerge: boolean,
): string {
  const lines: string[] = [
    "Automated queue-windows update from Temporal (`scout-queue-windows-daily`).",
    "",
    "Proposed from real match volume in the last",
    `${SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS.toString()} days against the ${BUCKET} bucket.`,
    "",
    "## Edits",
    "",
    "| Queue | Kind | Date | Detail |",
    "| --- | --- | --- | --- |",
    ...report.edits.map(
      (edit) =>
        `| ${tableCell(edit.queue)} | ${edit.kind} | ${edit.date} | ${tableCell(edit.message)} |`,
    ),
  ];

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const warning of report.warnings) {
      lines.push(`- **${warning.kind}**: ${warning.message}`);
    }
  }

  if (report.unknownQueueIds.length > 0) {
    lines.push(
      "",
      "## Unmapped queue ids",
      "",
      "Observed in the match lake with no `parseQueueType` mapping. A new mode",
      "shows up here first — add the QueueType enum value and the mapping, then",
      "the watcher maintains its windows.",
      "",
      "| Queue id | Matches |",
      "| --- | --- |",
      ...report.unknownQueueIds.map(
        (unknown) =>
          `| ${tableCell(unknown.queueId)} | ${unknown.total.toString()} |`,
      ),
    );
  }

  lines.push("", "## Patch notes", "");
  if ("error" in report.patchNotes) {
    lines.push(`- Patch notes unavailable: ${report.patchNotes.error}`);
  } else if (report.patchNotes.titles.length === 0) {
    lines.push("- No recent patch notes found.");
  } else {
    for (const note of report.patchNotes.titles) {
      lines.push(`- [${note.title}](${note.url})`);
    }
  }

  lines.push("");
  if (autoMerge) {
    lines.push(
      "Auto-merge enabled: every edit only opens/reopens a window (additive, reversible).",
    );
  } else {
    lines.push(
      "Auto-merge NOT enabled: this PR closes a window (retires a live mode).",
      "A human must confirm the close against the patch notes above before merging.",
    );
  }
  return lines.join("\n");
}
