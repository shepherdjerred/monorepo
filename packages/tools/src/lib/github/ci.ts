import { runGhCommand, runGhCommandRaw } from "./client.ts";
import {
  CheckRunSchema,
  WorkflowRunSchema,
  HeadRefResponseSchema,
} from "./schemas.ts";
import { z } from "zod";
import type { CheckRun, WorkflowRun } from "./types.ts";

export async function getCheckRuns(
  prNumber: number | string,
  repo?: string,
): Promise<CheckRun[]> {
  const result = await runGhCommand(
    [
      "pr",
      "checks",
      String(prNumber),
      "--json",
      "name,status,conclusion,detailsUrl,workflowName",
    ],
    z.array(CheckRunSchema),
    repo,
  );

  if (!result.success || !result.data) {
    return [];
  }

  return result.data;
}

export async function getWorkflowRuns(
  prNumber: number | string,
  repo?: string,
): Promise<WorkflowRun[]> {
  // Get the PR's head branch first
  const prResult = await runGhCommand(
    ["pr", "view", String(prNumber), "--json", "headRefName"],
    HeadRefResponseSchema,
    repo,
  );

  if (!prResult.success || !prResult.data) {
    return [];
  }

  const branch = prResult.data.headRefName;

  const result = await runGhCommand(
    [
      "run",
      "list",
      "--branch",
      branch,
      "--limit",
      "10",
      "--json",
      "databaseId,name,status,conclusion,url,createdAt",
    ],
    z.array(WorkflowRunSchema),
    repo,
  );

  if (!result.success || !result.data) {
    return [];
  }

  return result.data;
}

export async function getRunLogs(
  runId: number | string,
  repo?: string,
  options?: { failedOnly?: boolean | undefined; jobName?: string | undefined },
): Promise<string> {
  const args = ["run", "view", String(runId), "--log"];

  if (options?.failedOnly === true) {
    args.push("--log-failed");
  }

  if (options?.jobName != null && options.jobName.length > 0) {
    args.push("--job", options.jobName);
  }

  const result = await runGhCommandRaw(args, repo);

  if (!result.success) {
    return `Error fetching logs: ${result.error ?? "unknown error"}`;
  }

  return result.data ?? "";
}

export async function getFailedJobs(
  prNumber: number | string,
  repo?: string,
): Promise<{ name: string; runId: number }[]> {
  const checks = await getCheckRuns(prNumber, repo);
  const runs = await getWorkflowRuns(prNumber, repo);

  const failedJobs: { name: string; runId: number }[] = [];

  for (const check of checks) {
    if (check.conclusion === "failure") {
      // Find the corresponding run
      const run = runs.find((r) => r.name === check.workflowName);
      if (run != null) {
        failedJobs.push({ name: check.name, runId: run.databaseId });
      }
    }
  }

  return failedJobs;
}
