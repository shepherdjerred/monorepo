import * as Sentry from "@sentry/bun";
import type { Client } from "@temporalio/client";
import { WorkflowIdReusePolicy } from "@temporalio/common";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  CancelCiPipelinesInputSchema,
  type CancelCiPipelinesInput,
} from "#shared/schemas.ts";

const COMPONENT = "pr-webhook";

export type CancelStartFn = (input: CancelCiPipelinesInput) => Promise<void>;

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

/**
 * Dedupe key for one PR head.
 *
 * Renamed from the Buildkite-era `cancel-bk-builds-` prefix. These workflows
 * live about two minutes, so the only exposure is a `closed` webhook
 * redelivered across the deploy that changes it — which would start a second
 * cancel for the same head. Cancelling twice is idempotent, so that is a
 * better trade than keeping a name that no longer describes anything.
 */
function cancelWorkflowIdFor(input: CancelCiPipelinesInput): string {
  return `cancel-ci-pipelines-${input.owner}-${input.repo}-${String(input.prNumber)}-${input.commitSha}`;
}

export async function startCancelCiPipelines(
  client: Client,
  input: CancelCiPipelinesInput,
): Promise<void> {
  // REJECT_DUPLICATE so a redelivered `closed` webhook for the same head sha
  // no-ops at the Temporal server. The already-started error is the expected
  // idempotent path — surface it as an info log, not a failure.
  try {
    await client.workflow.start("cancelCiPipelinesWorkflow", {
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowId: cancelWorkflowIdFor(input),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [input],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "cancel-ci-pipelines workflow already started", {
        prNumber: input.prNumber,
        branch: input.branch,
        workflowId: cancelWorkflowIdFor(input),
      });
      return;
    }
    throw error;
  }
}

/**
 * Handle a `pull_request` `closed` action (merge *or* plain close): start the
 * workflow that cancels any still-active CI pipelines for the head branch.
 * We intentionally do NOT skip draft or bot PRs — bot branches (Renovate)
 * churn the most CI, so cancelling them saves the most. Returns a `Response`
 * the Hono handler can return directly.
 */
export async function handleClosedPr(
  parsed: ClosedPrPayload,
  deliveryId: string,
  startCancel: CancelStartFn,
): Promise<Response> {
  const cancelInput: CancelCiPipelinesInput =
    CancelCiPipelinesInputSchema.parse({
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
    jsonLog("error", "Failed to start cancel-ci-pipelines workflow", {
      deliveryId,
      prNumber: cancelInput.prNumber,
      branch: cancelInput.branch,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("cancel start failed\n", { status: 500 });
  }

  jsonLog("info", "Started cancel-ci-pipelines workflow", {
    deliveryId,
    prNumber: cancelInput.prNumber,
    branch: cancelInput.branch,
    merged: cancelInput.merged,
  });
  return new Response("cancel started\n");
}
