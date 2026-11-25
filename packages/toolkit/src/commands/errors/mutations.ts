import {
  createTrackerIssue,
  importBugsink,
  updateIssuesState,
  type CreateTrackerIssueArgs,
  type ImportBugsinkArgs,
} from "#lib/errors/client.ts";
import type { ErrorsRequestOptions } from "#lib/errors/http.ts";
import type {
  BugsinkImportResult,
  IssueState,
} from "@shepherdjerred/errors/contract";
import { formatJson } from "#lib/output/formatter.ts";

export type MutationCommandOptions = ErrorsRequestOptions & {
  readonly json?: boolean | undefined;
};

function formatImportResultMarkdown(result: BugsinkImportResult): string {
  const mode = result.dryRun ? "Dry-run" : "Completed";
  return [
    `## Bugsink Import (${mode})`,
    "",
    `- **Projects imported:** ${String(result.projectsImported)}`,
    `- **Releases imported:** ${String(result.releasesImported)}`,
    `- **Issues imported:** ${String(result.issuesImported)}`,
    `- **Events imported:** ${String(result.eventsImported)}`,
    `- **Events skipped (existing):** ${String(result.eventsSkippedExisting)}`,
    `- **Fingerprints registered:** ${String(result.fingerprintsRegistered)}`,
    `- **Duration:** ${String(result.durationMs)} ms`,
  ].join("\n");
}

export async function updateIssueStateCommand(
  ids: readonly string[],
  state: IssueState,
  options: MutationCommandOptions & {
    readonly resolvedInRelease?: string | undefined;
  } = {},
): Promise<void> {
  const result = await updateIssuesState(
    {
      ids,
      state,
      resolvedInRelease: options.resolvedInRelease,
    },
    { baseUrl: options.baseUrl },
  );
  if (options.json === true) {
    console.log(formatJson(result));
    return;
  }
  console.log(`Updated ${String(result.updatedCount)} issue(s) to ${state}.`);
}

export async function trackerIssueCommand(
  issueId: string,
  args: CreateTrackerIssueArgs,
  options: MutationCommandOptions = {},
): Promise<void> {
  const result = await createTrackerIssue(issueId, args, {
    baseUrl: options.baseUrl,
  });
  if (options.json === true) {
    console.log(formatJson(result));
    return;
  }
  const verb = result.created ? "Created" : "Linked existing";
  console.log(
    `${verb} Tracker issue ${result.trackerIssueIdentifier}: ${result.trackerUrl}`,
  );
}

export async function importBugsinkCommand(
  args: ImportBugsinkArgs,
  options: MutationCommandOptions = {},
): Promise<void> {
  const result = await importBugsink(args, { baseUrl: options.baseUrl });
  console.log(
    options.json === true
      ? formatJson(result)
      : formatImportResultMarkdown(result),
  );
}
