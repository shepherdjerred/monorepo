import { formatJson } from "#lib/output/formatter.ts";
import {
  parseBugsinkIssueIds,
  resolveIssues,
  type ResolveIssuesResult,
} from "#lib/bugsink/resolver.ts";

export type ResolveCommandOptions = {
  confirm?: boolean;
  dryRun?: boolean;
  fromFile?: string | undefined;
  ids: string[];
  json?: boolean;
};

function formatIds(ids: readonly string[]): string[] {
  return ids.map((id) => `- ${id}`);
}

export function formatResolveResult(result: ResolveIssuesResult): string {
  const lines = [
    "## Bugsink Issue Resolution",
    "",
    `Mode: ${result.dryRun ? "DRY RUN" : "APPLY"}`,
    `Requested: ${String(result.requested.length)}`,
    `Eligible: ${String(result.eligible.length)}`,
    `Already resolved: ${String(result.skipped.length)}`,
    `Resolved: ${String(result.resolved.length)}`,
    "",
  ];

  if (result.eligible.length > 0) {
    lines.push(result.dryRun ? "Would resolve:" : "Eligible:");
    lines.push(...formatIds(result.eligible));
    lines.push("");
  }

  if (result.skipped.length > 0) {
    lines.push("Already resolved:");
    lines.push(...formatIds(result.skipped));
    lines.push("");
  }

  if (result.resolved.length > 0) {
    lines.push("Resolved and verified:");
    lines.push(...formatIds(result.resolved));
    lines.push("");
  }

  if (result.errors.length > 0) {
    lines.push("Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error.id}: ${error.message}`);
    }
    lines.push("");
  }

  if (result.success && result.dryRun) {
    lines.push(
      "No changes made. Re-run with --confirm to resolve eligible issues.",
    );
  }

  return lines.join("\n");
}

export async function resolveCommand(
  options: ResolveCommandOptions,
): Promise<void> {
  try {
    if (options.confirm === true && options.dryRun === true) {
      throw new Error("--confirm and --dry-run cannot be used together");
    }

    const fileContents =
      options.fromFile == null
        ? undefined
        : await Bun.file(options.fromFile).text();
    const issueIds = parseBugsinkIssueIds(options.ids, fileContents);
    const result = await resolveIssues(issueIds, {
      confirm: options.confirm,
      dryRun: options.dryRun,
    });

    if (options.json === true) {
      console.log(formatJson(result));
    } else {
      console.log(formatResolveResult(result));
    }

    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    if (options.json === true) {
      console.log(formatJson({ success: false, error: message }));
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
  }
}
