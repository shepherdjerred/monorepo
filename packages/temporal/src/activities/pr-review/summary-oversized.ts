import path from "node:path";
import type { PrSummaryInput } from "#shared/schemas.ts";
import { SUMMARY_MARKER } from "./summary-prompts.ts";

export const OVERSIZED_SUMMARY_FILE_THRESHOLD = 200;

const OVERSIZED_SUMMARY_TOP_PATHS = 40;

export type SummaryFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
};

function extensionFor(filePath: string): string {
  const ext = path.extname(filePath);
  return ext.length === 0 ? "(none)" : ext;
}

function countByStatus(files: readonly SummaryFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  }
  return counts;
}

function countByExtension(files: readonly SummaryFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const ext = extensionFor(file.filename);
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: ReadonlyMap<string, number>): string {
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => `${key}: ${String(count)}`)
    .join(", ");
}

export function renderOversizedSummary(
  pr: PrSummaryInput,
  files: readonly SummaryFile[],
): string {
  const sortedFiles = [...files].toSorted(
    (a, b) =>
      b.additions + b.deletions - (a.additions + a.deletions) ||
      a.filename.localeCompare(b.filename),
  );
  const topFiles = sortedFiles.slice(0, OVERSIZED_SUMMARY_TOP_PATHS);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const missingPatchCount = files.filter((file) => file.patch === null).length;
  const lines: string[] = [];
  lines.push(SUMMARY_MARKER);
  lines.push("");
  lines.push(
    `## Oversized PR summary for #${String(pr.prNumber)}: ${pr.prTitle}`,
  );
  lines.push("");
  lines.push(
    "Detailed diff review was skipped because this PR is too large for the normal SDK summary path.",
  );
  lines.push("");
  lines.push(`- Changed files: ${String(files.length)}`);
  lines.push(
    `- Additions/deletions: +${String(additions)} / -${String(deletions)}`,
  );
  lines.push(
    `- Files without patch text from GitHub: ${String(missingPatchCount)}`,
  );
  lines.push(`- Status breakdown: ${formatCounts(countByStatus(files))}`);
  lines.push(`- Extension breakdown: ${formatCounts(countByExtension(files))}`);
  lines.push("");
  lines.push(`Top changed paths by churn (first ${String(topFiles.length)}):`);
  lines.push("");
  for (const file of topFiles) {
    lines.push(
      `- \`${file.filename}\` (${file.status}, +${String(file.additions)} / -${String(file.deletions)})`,
    );
  }
  if (files.length > topFiles.length) {
    lines.push(
      `- ... ${String(files.length - topFiles.length)} more files omitted`,
    );
  }
  lines.push("");
  lines.push(
    "Use a smaller follow-up PR for line-level review, or inspect the archive/import mechanically.",
  );
  return lines.join("\n");
}
