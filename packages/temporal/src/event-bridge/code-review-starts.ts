import * as Sentry from "@sentry/bun";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowNotFoundError,
} from "@temporalio/common";
import {
  PrCodeReviewWorkflowInputSchema,
  prCodeReviewWorkflowId,
  type PrCodeReviewWorkflowInput,
} from "#shared/ci/code-review.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { jsonLog } from "./webhook-log.ts";

const COMPONENT = "pr-webhook";

export const CODE_REVIEW_START_ACTIONS = new Set([
  "opened",
  "ready_for_review",
  "synchronize",
  "reopened",
  "edited",
]);

export const CODE_REVIEW_STOP_ACTIONS = new Set([
  "closed",
  "converted_to_draft",
]);

export type CodeReviewPrStartArgs = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
};

export type CodeReviewPrStopArgs = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  reason: string;
};

export type WebhookCodeReviewTemporalClient = {
  workflow: {
    start: (
      workflowType: string,
      options: {
        taskQueue: string;
        workflowId: string;
        workflowIdReusePolicy: WorkflowIdReusePolicy;
        workflowIdConflictPolicy: WorkflowIdConflictPolicy;
        args: unknown[];
      },
    ) => Promise<unknown>;
    getHandle: (workflowId: string) => {
      signal: (signalName: string) => Promise<unknown>;
    };
  };
};

export async function startPrCodeReviewFromWebhook(
  client: WebhookCodeReviewTemporalClient,
  args: CodeReviewPrStartArgs,
): Promise<void> {
  const input: PrCodeReviewWorkflowInput =
    PrCodeReviewWorkflowInputSchema.parse({
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      headSha: args.headSha,
      baseRef: args.baseRef,
    });
  const workflowId = prCodeReviewWorkflowId(
    input.owner,
    input.repo,
    input.prNumber,
    input.headSha,
  );
  await client.workflow.start("prCodeReviewWorkflow", {
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    args: [input],
  });
  jsonLog("info", "Started PR code-review workflow", {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    headSha: input.headSha,
    workflowId,
  });
}

export async function stopPrCodeReviewFromWebhook(
  client: WebhookCodeReviewTemporalClient,
  args: CodeReviewPrStopArgs,
): Promise<void> {
  const workflowId = prCodeReviewWorkflowId(
    args.owner,
    args.repo,
    args.prNumber,
    args.headSha,
  );
  try {
    await client.workflow.getHandle(workflowId).signal("recheckReview");
    jsonLog("info", "Signaled PR code-review workflow to recheck lifecycle", {
      owner: args.owner,
      repo: args.repo,
      prNumber: args.prNumber,
      headSha: args.headSha,
      reason: args.reason,
      workflowId,
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) {
      return;
    }
    throw error;
  }
}

export function captureCodeReviewWebhookError(
  error: unknown,
  ctx: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setContext("code-review-webhook", ctx);
    Sentry.captureException(error);
  });
  jsonLog("error", "Failed to reconcile PR code-review workflow from webhook", {
    ...ctx,
    error: error instanceof Error ? error.message : String(error),
  });
}
