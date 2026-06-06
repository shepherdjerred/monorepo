import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { WorkflowIdReusePolicy } from "@temporalio/common";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  CancelBuildkiteBuildsInputSchema,
  type CancelBuildkiteBuildsInput,
} from "#shared/schemas.ts";

const COMPONENT = "pr-webhook";

export type CancelStartFn = (
  input: CancelBuildkiteBuildsInput,
) => Promise<void>;

/** Minimal shape this module consumes from a parsed `pull_request` payload. */
export type ClosedPrPayload = {
  repository: { name: string; owner: { login: string } };
  pull_request: {
    number: number;
    merged?: boolean | undefined;
    head: { ref: string; sha: string };
  };
};

function jsonLog(
  level: "info" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function cancelBuildkiteWorkflowIdFor(
  input: CancelBuildkiteBuildsInput,
): string {
  return `cancel-bk-builds-${input.owner}-${input.repo}-${String(input.prNumber)}-${input.commitSha}`;
}

export async function startCancelBuildkiteBuilds(
  client: Client,
  input: CancelBuildkiteBuildsInput,
): Promise<void> {
  // REJECT_DUPLICATE so a redelivered `closed` webhook for the same head sha
  // no-ops at the Temporal server. The already-started error is the expected
  // idempotent path — surface it as an info log, not a failure.
  try {
    await client.workflow.start("cancelBuildkiteBuildsWorkflow", {
      taskQueue: TASK_QUEUES.DEFAULT,
      workflowId: cancelBuildkiteWorkflowIdFor(input),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [input],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "cancel-bk-builds workflow already started", {
        prNumber: input.prNumber,
        branch: input.branch,
        workflowId: cancelBuildkiteWorkflowIdFor(input),
      });
      return;
    }
    throw error;
  }
}

/**
 * Handle a `pull_request` `closed` action (merge *or* plain close): start the
 * workflow that cancels any still-active Buildkite builds for the head branch.
 * We intentionally do NOT skip draft or bot PRs — bot branches (Renovate)
 * churn the most CI, so cancelling them saves the most. Returns a `Response`
 * the Hono handler can return directly.
 */
export async function handleClosedPr(
  parsed: ClosedPrPayload,
  deliveryId: string,
  startCancel: CancelStartFn,
): Promise<Response> {
  const cancelInput: CancelBuildkiteBuildsInput =
    CancelBuildkiteBuildsInputSchema.parse({
      owner: parsed.repository.owner.login,
      repo: parsed.repository.name,
      prNumber: parsed.pull_request.number,
      branch: parsed.pull_request.head.ref,
      commitSha: parsed.pull_request.head.sha,
      merged: parsed.pull_request.merged ?? false,
    });

  try {
    await startCancel(cancelInput);
  } catch (error: unknown) {
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setContext("webhook", {
        deliveryId,
        action: "closed",
        owner: cancelInput.owner,
        repo: cancelInput.repo,
        prNumber: cancelInput.prNumber,
        branch: cancelInput.branch,
      });
      Sentry.captureException(error);
    });
    jsonLog("error", "Failed to start cancel-bk-builds workflow", {
      deliveryId,
      prNumber: cancelInput.prNumber,
      branch: cancelInput.branch,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("cancel start failed\n", { status: 500 });
  }

  jsonLog("info", "Started cancel-bk-builds workflow", {
    deliveryId,
    prNumber: cancelInput.prNumber,
    branch: cancelInput.branch,
    merged: cancelInput.merged,
  });
  return new Response("cancel started\n");
}
