import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { createTemporalClient } from "#client";
import {
  codeReviewConfig,
  type CodeReviewRuntimeConfig,
} from "#config/code-review.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import {
  prCodeReviewAssignmentsTotal,
  prCodeReviewDurationSeconds,
  prCodeReviewOutcomesTotal,
  prCodeReviewProviderCooldownsTotal,
} from "#observability/metrics-code-review.ts";
import {
  CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
  CODE_REVIEW_STATUS_CONTEXT,
  PrCodeReviewWorkflowInputSchema,
  prCodeReviewWorkflowId,
  type BackfillOpenPrCodeReviewsInput,
  type ClaimProviderSignalPayload,
  type PrCodeReviewWorkflowInput,
  type ReportProviderOutcomePayload,
} from "#shared/ci/code-review.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  defaultCreateCommitStatus,
  defaultListOpenMainPrs,
} from "./code-review-octokit.ts";
import {
  inspectPrReviewContextImpl,
  triggerAndObserveProviderImpl,
  verifyAndCheckBlockingThreadsImpl,
} from "./code-review-github.ts";
import type {
  CodeReviewActivityDeps,
  InspectPrReviewContextInput,
  InspectPrReviewContextResult,
  OpenMainPrRef,
  PostCodeReviewCommitStatusInput,
  TriggerAndObserveProviderInput,
  TriggerAndObserveProviderResult,
  VerifyAndCheckBlockingThreadsInput,
  VerifyAndCheckBlockingThreadsResult,
} from "./code-review-types.ts";

export function createCodeReviewActivities(deps: CodeReviewActivityDeps = {}) {
  const createInstallationToken =
    deps.createInstallationToken ?? createGitHubAppInstallationToken;
  const getTemporalClient = deps.getTemporalClient ?? createTemporalClient;
  const getRuntimeConfig = deps.getRuntimeConfig ?? codeReviewConfig;
  const listOpenMainPrs = deps.listOpenMainPrs ?? defaultListOpenMainPrs;
  const createCommitStatus =
    deps.createCommitStatus ?? defaultCreateCommitStatus;

  return {
    async loadCodeReviewRuntimeConfig(): Promise<CodeReviewRuntimeConfig> {
      return await getRuntimeConfig();
    },

    async inspectPrReviewContext(
      input: InspectPrReviewContextInput,
    ): Promise<InspectPrReviewContextResult> {
      return await inspectPrReviewContextImpl(input, deps);
    },

    async dispatchCoordinatorClaim(
      payload: ClaimProviderSignalPayload,
    ): Promise<void> {
      const client = await getTemporalClient();
      await client.workflow.signalWithStart("codeReviewCoordinatorWorkflow", {
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        signal: "claimProvider",
        signalArgs: [payload],
      });
    },

    async reportCoordinatorOutcome(
      payload: ReportProviderOutcomePayload,
    ): Promise<void> {
      const client = await getTemporalClient();
      await client.workflow.signalWithStart("codeReviewCoordinatorWorkflow", {
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        signal: "reportProviderOutcome",
        signalArgs: [payload],
      });
      prCodeReviewAssignmentsTotal.inc({ provider: payload.providerId });
      if (payload.cooldownMs > 0) {
        prCodeReviewProviderCooldownsTotal.inc({
          provider: payload.providerId,
          reason: payload.outcome,
        });
      }
    },

    async postCodeReviewCommitStatus(
      input: PostCodeReviewCommitStatusInput,
    ): Promise<void> {
      const { token } = await createInstallationToken();
      await createCommitStatus(token, {
        owner: input.owner,
        repo: input.repo,
        sha: input.sha,
        context: CODE_REVIEW_STATUS_CONTEXT,
        state: input.state,
        description: input.description.slice(0, 140),
        targetUrl: input.targetUrl,
      });
      if (
        (input.state === "success" || input.state === "failure") &&
        input.recordOutcome !== false
      ) {
        const reason =
          input.reason ??
          (input.state === "success" ? "clean" : "blocking-findings");
        prCodeReviewOutcomesTotal.inc({
          result: input.state,
          reason,
        });
        if (input.durationSeconds !== undefined) {
          prCodeReviewDurationSeconds.observe(
            { result: input.state },
            input.durationSeconds,
          );
        }
      }
    },

    async triggerAndObserveProvider(
      input: TriggerAndObserveProviderInput,
    ): Promise<TriggerAndObserveProviderResult> {
      return await triggerAndObserveProviderImpl(input, deps);
    },

    async verifyAndCheckBlockingThreads(
      input: VerifyAndCheckBlockingThreadsInput,
    ): Promise<VerifyAndCheckBlockingThreadsResult> {
      return await verifyAndCheckBlockingThreadsImpl(input, deps);
    },

    async listOpenMainPrsForCodeReview(
      input: BackfillOpenPrCodeReviewsInput,
    ): Promise<OpenMainPrRef[]> {
      const { token } = await createInstallationToken();
      return await listOpenMainPrs(token, input);
    },

    async startPrCodeReviewWorkflow(
      input: PrCodeReviewWorkflowInput,
    ): Promise<void> {
      const validated = PrCodeReviewWorkflowInputSchema.parse(input);
      const client = await getTemporalClient();
      await client.workflow.start("prCodeReviewWorkflow", {
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: prCodeReviewWorkflowId(
          validated.owner,
          validated.repo,
          validated.prNumber,
          validated.headSha,
        ),
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
        args: [validated],
      });
    },
  };
}

export const codeReviewActivities = createCodeReviewActivities();
export type CodeReviewActivities = typeof codeReviewActivities;
