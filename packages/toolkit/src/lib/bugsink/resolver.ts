import { getIssue, resolveIssue } from "./issues.ts";
import type { BugsinkIssue } from "./types.ts";
import { z } from "zod";

const BugsinkIssueIdSchema = z.uuid();

export type BugsinkIssueResolverApi = {
  getIssue: (issueId: string) => Promise<BugsinkIssue | null>;
  resolveIssue: (issue: BugsinkIssue) => Promise<void>;
};

export type ResolveIssuesOptions = {
  confirm?: boolean | undefined;
  dryRun?: boolean | undefined;
  api?: BugsinkIssueResolverApi;
};

export type ResolveIssuesResult = {
  success: boolean;
  dryRun: boolean;
  requested: string[];
  eligible: string[];
  skipped: string[];
  resolved: string[];
  errors: { id: string; message: string }[];
};

const defaultApi: BugsinkIssueResolverApi = { getIssue, resolveIssue };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function normalizeBugsinkIssueIds(values: readonly string[]): string[] {
  if (values.length === 0) {
    throw new Error("At least one Bugsink issue UUID is required");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = value.trim();
    const parsed = BugsinkIssueIdSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid Bugsink issue UUID: ${candidate}`);
    }
    if (!seen.has(parsed.data)) {
      seen.add(parsed.data);
      normalized.push(parsed.data);
    }
  }

  return normalized;
}

export function parseBugsinkIssueIds(
  positionals: readonly string[],
  fileContents?: string,
): string[] {
  const fileIds =
    fileContents == null
      ? []
      : fileContents
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

  return normalizeBugsinkIssueIds([...positionals, ...fileIds]);
}

type FailureResultOptions = {
  requested: string[];
  dryRun: boolean;
  errors: { id: string; message: string }[];
  eligible?: string[];
  skipped?: string[];
  resolved?: string[];
};

function failureResult({
  requested,
  dryRun,
  errors,
  eligible = [],
  skipped = [],
  resolved = [],
}: FailureResultOptions): ResolveIssuesResult {
  return {
    success: false,
    dryRun,
    requested,
    eligible,
    skipped,
    resolved,
    errors,
  };
}

export async function resolveIssues(
  issueIds: readonly string[],
  options: ResolveIssuesOptions = {},
): Promise<ResolveIssuesResult> {
  const requested = normalizeBugsinkIssueIds(issueIds);
  const dryRun = options.dryRun === true || options.confirm !== true;
  const api = options.api ?? defaultApi;
  const eligibleIssues: BugsinkIssue[] = [];
  const eligible: string[] = [];
  const skipped: string[] = [];
  const preflightErrors: { id: string; message: string }[] = [];

  for (const issueId of requested) {
    try {
      const issue = await api.getIssue(issueId);
      if (issue == null) {
        preflightErrors.push({ id: issueId, message: "Issue not found" });
      } else if (issue.is_muted) {
        preflightErrors.push({ id: issueId, message: "Issue is muted" });
      } else if (issue.is_resolved) {
        skipped.push(issueId);
      } else {
        eligibleIssues.push(issue);
        eligible.push(issueId);
      }
    } catch (error) {
      preflightErrors.push({ id: issueId, message: errorMessage(error) });
    }
  }

  if (preflightErrors.length > 0) {
    return failureResult({
      requested,
      dryRun,
      errors: preflightErrors,
      eligible,
      skipped,
    });
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      requested,
      eligible,
      skipped,
      resolved: [],
      errors: [],
    };
  }

  const resolved: string[] = [];
  for (const issue of eligibleIssues) {
    try {
      await api.resolveIssue(issue);
      const verified = await api.getIssue(issue.id);
      if (verified == null) {
        return failureResult({
          requested,
          dryRun: false,
          errors: [
            { id: issue.id, message: "Issue disappeared during verification" },
          ],
          eligible,
          skipped,
          resolved,
        });
      }
      if (!verified.is_resolved || verified.is_muted) {
        return failureResult({
          requested,
          dryRun: false,
          errors: [
            {
              id: issue.id,
              message: "Verification failed: issue is not resolved and unmuted",
            },
          ],
          eligible,
          skipped,
          resolved,
        });
      }
      resolved.push(issue.id);
    } catch (error) {
      return failureResult({
        requested,
        dryRun: false,
        errors: [{ id: issue.id, message: errorMessage(error) }],
        eligible,
        skipped,
        resolved,
      });
    }
  }

  return {
    success: true,
    dryRun: false,
    requested,
    eligible,
    skipped,
    resolved,
    errors: [],
  };
}
