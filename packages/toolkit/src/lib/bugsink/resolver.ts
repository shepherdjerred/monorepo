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

type PreflightResult =
  | { kind: "eligible"; issue: BugsinkIssue }
  | { kind: "skipped" }
  | { kind: "error"; error: { id: string; message: string } };

async function preflightIssue(
  api: BugsinkIssueResolverApi,
  issueId: string,
): Promise<PreflightResult> {
  try {
    const issue = await api.getIssue(issueId);
    if (issue == null) {
      return {
        kind: "error",
        error: { id: issueId, message: "Issue not found" },
      };
    }
    if (issue.is_muted) {
      return {
        kind: "error",
        error: { id: issueId, message: "Issue is muted" },
      };
    }
    if (issue.is_resolved) {
      return { kind: "skipped" };
    }
    return { kind: "eligible", issue };
  } catch (error) {
    return {
      kind: "error",
      error: { id: issueId, message: errorMessage(error) },
    };
  }
}

async function preflightIssues(
  api: BugsinkIssueResolverApi,
  requested: readonly string[],
): Promise<{
  eligibleIssues: BugsinkIssue[];
  eligible: string[];
  skipped: string[];
  errors: { id: string; message: string }[];
}> {
  const eligibleIssues: BugsinkIssue[] = [];
  const eligible: string[] = [];
  const skipped: string[] = [];
  const errors: { id: string; message: string }[] = [];

  for (const issueId of requested) {
    const result = await preflightIssue(api, issueId);
    if (result.kind === "eligible") {
      eligibleIssues.push(result.issue);
      eligible.push(issueId);
    } else if (result.kind === "skipped") {
      skipped.push(issueId);
    } else {
      errors.push(result.error);
    }
  }

  return { eligibleIssues, eligible, skipped, errors };
}

function verificationError(issue: BugsinkIssue | null): string | null {
  if (issue == null) {
    return "Issue disappeared during verification";
  }
  if (!issue.is_resolved || issue.is_muted) {
    return "Verification failed: issue is not resolved and unmuted";
  }
  return null;
}

async function resolveEligibleIssues(
  api: BugsinkIssueResolverApi,
  issues: readonly BugsinkIssue[],
): Promise<{
  resolved: string[];
  error: { id: string; message: string } | null;
}> {
  const resolved: string[] = [];
  for (const issue of issues) {
    try {
      await api.resolveIssue(issue);
      const error = verificationError(await api.getIssue(issue.id));
      if (error !== null) {
        return { resolved, error: { id: issue.id, message: error } };
      }
      resolved.push(issue.id);
    } catch (error) {
      return {
        resolved,
        error: { id: issue.id, message: errorMessage(error) },
      };
    }
  }
  return { resolved, error: null };
}

export async function resolveIssues(
  issueIds: readonly string[],
  options: ResolveIssuesOptions = {},
): Promise<ResolveIssuesResult> {
  const requested = normalizeBugsinkIssueIds(issueIds);
  const dryRun = options.dryRun === true || options.confirm !== true;
  const api = options.api ?? defaultApi;
  const { eligibleIssues, eligible, skipped, errors } = await preflightIssues(
    api,
    requested,
  );

  if (errors.length > 0) {
    return failureResult({
      requested,
      dryRun,
      errors,
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

  const { resolved, error } = await resolveEligibleIssues(api, eligibleIssues);
  if (error !== null) {
    return failureResult({
      requested,
      dryRun: false,
      errors: [error],
      eligible,
      skipped,
      resolved,
    });
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
