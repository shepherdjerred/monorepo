import { formatDurationCompact } from "#lib/tend/paths.ts";
import {
  type ClassifiedLease,
  formatGiB,
  type SurfaceSweepResult,
  type TendRunReport,
} from "#lib/tend/types.ts";

function padCell(value: string, width: number): string {
  return value.length >= width
    ? value
    : `${value}${" ".repeat(width - value.length)}`;
}

function surfaceStateText(surface: SurfaceSweepResult): string {
  if (surface.heldReason !== undefined) {
    return `HELD (${surface.heldReason})`;
  }
  return surface.skippedReason === undefined
    ? "ok"
    : `SKIPPED (${surface.skippedReason})`;
}

function modeBanner(mode: TendRunReport["mode"]): string {
  if (mode === "status") {
    return "STATUS (read-only)";
  }
  return mode === "apply" ? "APPLY" : "DRY-RUN (pass --apply to remove)";
}

function formatHeaderLines(report: TendRunReport): string[] {
  const lines: string[] = [];
  const forumDesc = report.liveness.forumAvailable
    ? `${String(report.liveness.activeHostNotices.length)} host notice(s)`
    : "unavailable";
  const hcDesc = report.liveness.hcAvailable ? "hc ok" : "hc unavailable";

  lines.push(
    `toolkit tend — ${modeBanner(report.mode)} on ${report.host} (worktree floor: ${formatDurationCompact(report.worktreeMinAgeMs)})`,
    `Liveness: Herdr terminals=${String(report.liveness.liveTerminalCount)} (${hcDesc}), Forum=${forumDesc}`,
  );

  if (report.disk != null) {
    lines.push(
      `Disk (${report.disk.path}): ${formatGiB(report.disk.availableBytes)} free / ${formatGiB(report.disk.totalBytes)} total (${report.disk.level.toUpperCase()})`,
    );
  }
  if (report.dockerDisk != null) {
    const dockerSummary = report.dockerDisk.available
      ? report.dockerDisk.rows
          .map(
            (row) => `${row.type}=${row.size} (reclaimable ${row.reclaimable})`,
          )
          .join(", ") || "empty"
      : `unavailable (${report.dockerDisk.skippedReason ?? "docker daemon not running"})`;
    lines.push(`Docker disk: ${dockerSummary}`);
  }

  if (report.lastRun !== null) {
    const runMode = report.lastRun.apply ? "apply" : "dry-run";
    lines.push(
      `Last run: ${report.lastRun.ts} (${runMode}, candidates=${String(report.lastRun.candidateCount)}, removed=${String(report.lastRun.removedCount)}, failed=${String(report.lastRun.failedCount)})`,
    );
  } else if (report.mode === "status") {
    lines.push("Last run: none recorded");
  }

  for (const warning of report.liveness.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  for (const notice of report.liveness.activeHostNotices) {
    lines.push(
      `Notice hold [${notice.id}]: ${notice.title} (${notice.scopes.join(", ")})`,
    );
  }
  return lines;
}

function formatActionTag(
  status: "planned" | "removed" | "skipped" | "failed",
): string {
  if (status === "removed") {
    return "REMOVED";
  }
  return status === "failed" ? "FAILED" : "WOULD REMOVE";
}

function formatCandidateLines(
  surfaces: readonly SurfaceSweepResult[],
  verbose: boolean,
): string[] {
  const itemLines: string[] = [];
  for (const sr of surfaces) {
    for (const action of sr.actions) {
      if (!verbose && sr.actions.length > 50 && itemLines.length >= 50) {
        break;
      }
      const suffix = action.detail === undefined ? "" : ` — ${action.detail}`;
      itemLines.push(
        `  [${formatActionTag(action.status)}] (${sr.surface}/${action.candidate.kind}) ${action.candidate.target} — ${action.candidate.reason}${suffix}`,
      );
    }
  }
  return itemLines;
}

/** Per-reason counts of what each surface decided to keep. */
function formatKeepSummaryLines(
  surfaces: readonly SurfaceSweepResult[],
): string[] {
  const lines: string[] = [];
  for (const sr of surfaces) {
    const counts = new Map<string, number>();
    for (const decision of sr.decisions ?? []) {
      if (decision.action === "keep") {
        counts.set(decision.category, (counts.get(decision.category) ?? 0) + 1);
      }
    }
    if (counts.size === 0) {
      continue;
    }
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    lines.push(`Kept (${sr.surface}): ${String(total)}`);
    const ordered = [...counts.entries()].sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    );
    for (const [category, count] of ordered) {
      lines.push(`  ${padCell(String(count), 5)}${category}`);
    }
  }
  return lines;
}

function formatKeptLines(surfaces: readonly SurfaceSweepResult[]): string[] {
  const lines: string[] = [];
  for (const sr of surfaces) {
    for (const decision of sr.decisions ?? []) {
      if (decision.action === "keep") {
        lines.push(
          `  [KEEP] (${sr.surface}) ${decision.target} — ${decision.reason}`,
        );
      }
    }
  }
  return lines;
}

export function formatTendReport(
  report: TendRunReport,
  options: {
    readonly verbose?: boolean | undefined;
    readonly summaryOnly?: boolean | undefined;
  } = {},
): string {
  const lines = formatHeaderLines(report);
  lines.push(
    "",
    `${padCell("SURFACE", 17)}${padCell("INSPECTED", 11)}${padCell("CANDIDATES", 12)}${padCell("REMOVED", 9)}STATE`,
  );

  for (const sr of report.surfaces) {
    const removed = sr.actions.filter((a) => a.status === "removed").length;
    lines.push(
      `${padCell(sr.surface, 17)}${padCell(String(sr.inspectedCount), 11)}${padCell(String(sr.candidates.length), 12)}${padCell(String(removed), 9)}${surfaceStateText(sr)}`,
    );
    for (const warning of sr.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  const keepSummary = formatKeepSummaryLines(report.surfaces);
  if (keepSummary.length > 0) {
    lines.push("", ...keepSummary);
  }

  if (options.summaryOnly !== true) {
    const itemLines = formatCandidateLines(
      report.surfaces,
      options.verbose === true,
    );
    if (itemLines.length > 0) {
      lines.push("", "Candidates:", ...itemLines);
    }
    const keptLines =
      options.verbose === true ? formatKeptLines(report.surfaces) : [];
    if (keptLines.length > 0) {
      lines.push("", "Kept:", ...keptLines);
    }
  }

  lines.push(
    "",
    `Totals: ${String(report.totals.candidates)} candidate(s), ${String(report.totals.removed)} removed, ${String(report.totals.failed)} failed`,
  );
  return lines.join("\n");
}

export function formatLeaseList(leases: readonly ClassifiedLease[]): string {
  if (leases.length === 0) {
    return "No leases recorded.";
  }
  const lines = [
    `${padCell("ID", 36)}${padCell("KIND", 18)}${padCell("STATUS", 12)}${padCell("PID", 9)}TARGET (EXPIRES)`,
  ];
  for (const item of leases) {
    lines.push(
      `${padCell(item.lease.id, 36)}${padCell(item.lease.kind, 18)}${padCell(item.status, 12)}${padCell(String(item.lease.ownerPid), 9)}${item.lease.target} (${item.lease.expiresAt})`,
    );
  }
  return lines.join("\n");
}
