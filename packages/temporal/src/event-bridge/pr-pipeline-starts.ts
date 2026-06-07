import type { Client } from "@temporalio/client";
import { WorkflowIdReusePolicy } from "@temporalio/common";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type {
  PrAgentInput,
  PrReviewPipelineInput,
  PrSummaryInput,
} from "#shared/schemas.ts";
import { jsonLog } from "./webhook-log.ts";

function pipelineWorkflowIdFor(pr: PrReviewPipelineInput): string {
  return `pr-review-pipeline-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
}

function summaryPipelineWorkflowIdFor(pr: PrSummaryInput): string {
  return `pr-summary-pipeline-${pr.owner}-${pr.repo}-${String(pr.prNumber)}-${pr.commitSha}`;
}

async function startPrReviewPipeline(
  client: Client,
  pipelineInput: PrReviewPipelineInput,
): Promise<void> {
  // REJECT_DUPLICATE so a redelivered webhook for the same commit sha
  // no-ops at the Temporal server rather than re-running the pipeline.
  // The "already-started" error is the expected idempotent path; surface
  // it as an info log rather than a workflow-start failure.
  try {
    await client.workflow.start("prReviewPipeline", {
      taskQueue: TASK_QUEUES.PR_REVIEW,
      workflowId: pipelineWorkflowIdFor(pipelineInput),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [pipelineInput],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "pr-review pipeline already started for this commit", {
        prNumber: pipelineInput.prNumber,
        commitSha: pipelineInput.commitSha,
        workflowId: pipelineWorkflowIdFor(pipelineInput),
      });
      return;
    }
    throw error;
  }
}

async function startPrSummaryPipeline(
  client: Client,
  summaryInput: PrSummaryInput,
): Promise<void> {
  // Same idempotency model as the review pipeline — redelivered webhooks
  // for the same commit sha no-op at the server.
  try {
    await client.workflow.start("prSummaryPipeline", {
      taskQueue: TASK_QUEUES.PR_SUMMARY,
      workflowId: summaryPipelineWorkflowIdFor(summaryInput),
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [summaryInput],
    });
  } catch (error: unknown) {
    if (error instanceof WorkflowExecutionAlreadyStartedError) {
      jsonLog("info", "pr-summary pipeline already started for this commit", {
        prNumber: summaryInput.prNumber,
        commitSha: summaryInput.commitSha,
        workflowId: summaryPipelineWorkflowIdFor(summaryInput),
      });
      return;
    }
    throw error;
  }
}

export async function startPrWorkflows(
  client: Client,
  input: PrAgentInput,
): Promise<void> {
  const pipelineInput: PrReviewPipelineInput = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    baseRef: input.baseRef,
    headRef: input.headRef,
    prTitle: input.prTitle,
    prAuthor: input.prAuthor,
  };

  const summaryInput: PrSummaryInput = {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    commitSha: input.commitSha,
    baseRef: input.baseRef,
    headRef: input.headRef,
    prTitle: input.prTitle,
    prAuthor: input.prAuthor,
  };

  // SOTA review pipeline (multi-specialist consensus + verification) +
  // summary pipeline (Haiku 4.5 + prompt caching) are now the sole path.
  // The legacy `prReview` + `prSummary` claude -p workflows were retired
  // in the cutover commit — see
  // packages/docs/plans/2026-05-10_sota-pr-review-bot.md addendum.
  await Promise.all([
    startPrReviewPipeline(client, pipelineInput),
    startPrSummaryPipeline(client, summaryInput),
  ]);
}
