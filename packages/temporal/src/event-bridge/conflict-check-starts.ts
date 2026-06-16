import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  CheckPrMergeConflictsInputSchema,
  type CheckPrMergeConflictsInput,
} from "#shared/schemas.ts";
import { jsonLog } from "./webhook-log.ts";

const COMPONENT = "pr-webhook";

export type ConflictCheckStartFn = (
  input: CheckPrMergeConflictsInput,
) => Promise<void>;

function workflowIdFor(input: CheckPrMergeConflictsInput): string {
  if (input.kind === "all-prs") {
    // Singleton — a newer push to main supersedes any in-flight run.
    return `check-pr-merge-conflicts-main`;
  }
  return `check-pr-merge-conflict-pr-${String(input.prNumber)}`;
}

async function startConflictCheck(
  client: Client,
  input: CheckPrMergeConflictsInput,
): Promise<void> {
  // "Terminate existing" semantics — for the singleton main trigger a newer
  // push must supersede an in-flight check (we only care about the freshest
  // answer). For per-PR triggers the same logic holds per-PR: a fresh
  // synchronize replaces a still-running check from the previous head SHA.
  // (Combining reuse=ALLOW_DUPLICATE with conflict=TERMINATE_EXISTING is the
  // current Temporal API for what used to be TERMINATE_IF_RUNNING.)
  await client.workflow.start("checkPrMergeConflictsWorkflow", {
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowId: workflowIdFor(input),
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.TERMINATE_EXISTING,
    args: [input],
  });
}

export async function startCheckPrMergeConflictsForMain(
  client: Client,
  args: { owner: string; repo: string; mainSha: string },
): Promise<void> {
  const input: CheckPrMergeConflictsInput =
    CheckPrMergeConflictsInputSchema.parse({
      kind: "all-prs",
      owner: args.owner,
      repo: args.repo,
      mainSha: args.mainSha,
    });
  await startConflictCheck(client, input);
  jsonLog("info", "Started merge-conflict check (main push)", {
    owner: args.owner,
    repo: args.repo,
    mainSha: args.mainSha,
    workflowId: workflowIdFor(input),
  });
}

export async function startCheckPrMergeConflictsForPr(
  client: Client,
  args: {
    owner: string;
    repo: string;
    prNumber: number;
    headSha: string;
    baseRef: string;
  },
): Promise<void> {
  const input: CheckPrMergeConflictsInput =
    CheckPrMergeConflictsInputSchema.parse({
      kind: "single-pr",
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      headSha: args.headSha,
      baseRef: args.baseRef,
    });
  await startConflictCheck(client, input);
  jsonLog("info", "Started merge-conflict check (PR event)", {
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    headSha: args.headSha,
    workflowId: workflowIdFor(input),
  });
}

/**
 * Centralized error capture so the webhook handler can hand off without
 * inlining its own try/catch + Sentry boilerplate per trigger.
 */
export function captureConflictCheckStartError(
  error: unknown,
  ctx: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setContext("conflict-check-start", ctx);
    Sentry.captureException(error);
  });
  jsonLog("error", "Failed to start merge-conflict check workflow", {
    ...ctx,
    error: error instanceof Error ? error.message : String(error),
  });
}
