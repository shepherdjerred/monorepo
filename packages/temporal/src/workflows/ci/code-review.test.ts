import { describe, expect, test, vi } from "vitest";
import { WorkflowClient } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { WorkflowIdReusePolicy } from "@temporalio/common";
import { Worker } from "@temporalio/worker";
import type { ProviderId } from "@shepherdjerred/code-review";
import type { CodeReviewActivities } from "#activities/ci/code-review.ts";
import type {
  InspectPrReviewContextResult,
  PostCodeReviewCommitStatusInput,
  TriggerAndObserveProviderInput,
  TriggerAndObserveProviderResult,
  VerifyAndCheckBlockingThreadsInput,
  VerifyAndCheckBlockingThreadsResult,
} from "#activities/ci/code-review-types.ts";
import {
  CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
  DEFAULT_CODE_REVIEW_SETTINGS,
  prCodeReviewWorkflowId,
  type ClaimProviderSignalPayload,
  type PrCodeReviewWorkflowInput,
  type ReportProviderOutcomePayload,
} from "#shared/ci/code-review.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";

const workflowPath = new URL("../index.ts", import.meta.url).pathname;

function makePrInput(
  prNumber: number,
  headSha = `sha-${String(prNumber)}`,
): PrCodeReviewWorkflowInput {
  return {
    owner: "shepherdjerred",
    repo: "monorepo",
    prNumber,
    headSha,
    baseRef: "main",
  };
}

function defaultContext(): InspectPrReviewContextResult {
  return {
    active: true,
    author: { login: "shepherdjerred", type: "User" },
    headPushedAt: "2026-11-24T00:00:00Z",
    p0VetoCount: 0,
    p0VetoSummary: null,
    completedAtHead: null,
    priorRoundCompleted: false,
  };
}

function reviewedObservation(): TriggerAndObserveProviderResult {
  return {
    active: true,
    reviewState: "reviewed",
    skipReason: null,
    blockedReason: null,
    requestOutcome: "requested",
    p0VetoCount: 0,
    p0VetoMessage: null,
    decisionState: "passed",
    decisionMessage: "Reviewed clean",
    blockingCount: 0,
  };
}

function usageLimitedObservation(): TriggerAndObserveProviderResult {
  return {
    active: true,
    reviewState: "errored",
    skipReason: null,
    blockedReason: "usage-limited",
    requestOutcome: null,
    p0VetoCount: 0,
    p0VetoMessage: null,
    decisionState: "failed",
    decisionMessage: "Usage limit reached",
    blockingCount: 0,
  };
}

async function terminateCoordinatorIfRunning(
  environment: TestWorkflowEnvironment,
): Promise<void> {
  try {
    await environment.client.workflow
      .getHandle(CODE_REVIEW_COORDINATOR_WORKFLOW_ID)
      .terminate("Test complete");
  } catch {
    // Coordinator was never started or already closed.
  }
}

function realTimeWorkflowClient(
  environment: TestWorkflowEnvironment,
): WorkflowClient {
  return new WorkflowClient({ connection: environment.connection });
}

async function startPrReview(
  workflowClient: WorkflowClient,
  prNumber: number,
  headSha?: string,
) {
  const input = makePrInput(prNumber, headSha);
  return await workflowClient.start("prCodeReviewWorkflow", {
    workflowId: prCodeReviewWorkflowId(
      input.owner,
      input.repo,
      input.prNumber,
      input.headSha,
    ),
    taskQueue: TASK_QUEUES.WORKFLOWS,
    args: [input],
  });
}

async function executePrReview(
  workflowClient: WorkflowClient,
  prNumber: number,
  headSha?: string,
): Promise<void> {
  const handle = await startPrReview(workflowClient, prNumber, headSha);
  await handle.result();
}

function recordObservedProvider(
  observedByPr: Map<number, ProviderId[]>,
  call: TriggerAndObserveProviderInput,
): void {
  const list = observedByPr.get(call.prNumber) ?? [];
  list.push(call.providerId);
  observedByPr.set(call.prNumber, list);
}

function buildCoordinatorBridgeActivities(
  environment: TestWorkflowEnvironment,
  overrides: Partial<CodeReviewActivities>,
): CodeReviewActivities {
  const workflowClient = realTimeWorkflowClient(environment);
  return {
    loadCodeReviewRuntimeConfig: async () => ({
      enabled: true,
      settings: DEFAULT_CODE_REVIEW_SETTINGS,
    }),
    inspectPrReviewContext: async () => defaultContext(),
    dispatchCoordinatorClaim: async (payload: ClaimProviderSignalPayload) => {
      await workflowClient.signalWithStart("codeReviewCoordinatorWorkflow", {
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        signal: "claimProvider",
        signalArgs: [payload],
      });
    },
    reportCoordinatorOutcome: async (payload: ReportProviderOutcomePayload) => {
      await workflowClient.signalWithStart("codeReviewCoordinatorWorkflow", {
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        signal: "reportProviderOutcome",
        signalArgs: [payload],
      });
    },
    postCodeReviewCommitStatus: async () => {
      // Default test stub records no commit status unless overridden.
    },
    triggerAndObserveProvider: async () => reviewedObservation(),
    verifyAndCheckBlockingThreads: async () => ({
      active: true,
      passed: true,
      failureReason: null,
      description: "Clean review",
    }),
    listOpenMainPrsForCodeReview: async () => [],
    startPrCodeReviewWorkflow: async () => {
      // Default test stub starts no workflow unless overridden.
    },
    ...overrides,
  };
}

describe("PR code-review assignment and quota failover", () => {
  test("happy path: assigns highest-weight provider (coderabbit), requests review, posts success, and replays cleanly", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const statuses: PostCodeReviewCommitStatusInput[] = [];
    const triggerCalls: TriggerAndObserveProviderInput[] = [];

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          postCodeReviewCommitStatus: async (status) => {
            statuses.push(status);
          },
          triggerAndObserveProvider: async (call) => {
            triggerCalls.push(call);
            return reviewedObservation();
          },
          verifyAndCheckBlockingThreads: async ({ providerId }) => ({
            active: true,
            passed: true,
            failureReason: null,
            description: `${String(providerId)} reviewed clean`,
          }),
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            const handle = await startPrReview(workflowClient, 101);
            await handle.result();

            expect(triggerCalls).toHaveLength(1);
            expect(triggerCalls[0]).toMatchObject({
              providerId: "coderabbit",
              attempt: 1,
              shouldRequest: true,
            });
            expect(statuses.map((s) => s.state)).toEqual([
              "pending",
              "success",
            ]);
            expect(statuses[0]?.description).toBe(
              "Waiting for CodeRabbit code review",
            );
            expect(statuses[1]).toMatchObject({
              state: "success",
              reason: "clean",
            });

            const prHistory = await handle.fetchHistory();
            await Worker.runReplayHistory(
              { workflowsPath: workflowPath },
              prHistory,
            );
            const coordHistory = await environment.client.workflow
              .getHandle(CODE_REVIEW_COORDINATOR_WORKFLOW_ID)
              .fetchHistory();
            await Worker.runReplayHistory(
              { workflowsPath: workflowPath },
              coordHistory,
            );
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("quota failover + advisory pass: coderabbit usage-limited fails over to codex; when codex is also usage-limited, ring exhaustion passes advisories", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const statuses: PostCodeReviewCommitStatusInput[] = [];
    const triedProviders: ProviderId[] = [];

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          postCodeReviewCommitStatus: async (status) => {
            statuses.push(status);
          },
          triggerAndObserveProvider: async (call) => {
            triedProviders.push(call.providerId);
            return usageLimitedObservation();
          },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            await executePrReview(workflowClient, 102);

            expect(triedProviders).toEqual(["coderabbit", "codex"]);
            expect(statuses.map((s) => s.state)).toEqual([
              "pending",
              "pending",
              "success",
            ]);
            expect(statuses.at(-1)).toMatchObject({
              state: "success",
              description:
                "All review providers quota-limited; passing advisories",
              reason: "quota-exempt",
            });
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);

  test("cooldown persistence: subsequent PR skips cooled-down coderabbit immediately and assigns codex", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const observedByPr = new Map<number, ProviderId[]>();

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          triggerAndObserveProvider: async (call) => {
            recordObservedProvider(observedByPr, call);
            return call.providerId === "coderabbit"
              ? usageLimitedObservation()
              : reviewedObservation();
          },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            await executePrReview(workflowClient, 201);
            await executePrReview(workflowClient, 202);

            expect(observedByPr.get(201)).toEqual(["coderabbit", "codex"]);
            expect(observedByPr.get(202)).toEqual(["codex"]);

            await environment.sleep("61m");
            await executePrReview(workflowClient, 203);
            await executePrReview(workflowClient, 204);
            expect(observedByPr.get(203)).toEqual(["codex"]);
            expect(observedByPr.get(204)).toEqual(["coderabbit", "codex"]);
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("PR code-review blocking thread watch and prior-round gates", () => {
  test("blocking P1 watch loop: posts failure on unresolved P1, then flips to success when resolved and recheckReview signaled", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const statuses: PostCodeReviewCommitStatusInput[] = [];
    let threadResolved = false;

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          postCodeReviewCommitStatus: async (status) => {
            statuses.push(status);
          },
          verifyAndCheckBlockingThreads: async (
            _input: VerifyAndCheckBlockingThreadsInput,
          ): Promise<VerifyAndCheckBlockingThreadsResult> =>
            threadResolved
              ? {
                  active: true,
                  passed: true,
                  failureReason: null,
                  description: "CodeRabbit reviewed clean",
                }
              : {
                  active: true,
                  passed: false,
                  failureReason: "blocking-findings",
                  description: "1 unresolved P0/P1 finding(s) from CodeRabbit",
                },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            const handle = await startPrReview(workflowClient, 301);

            await vi.waitFor(() => {
              expect(statuses.some((s) => s.state === "failure")).toBe(true);
            });

            threadResolved = true;
            await handle.signal("recheckReview");
            await handle.result();

            expect(statuses.map((s) => s.state)).toEqual([
              "pending",
              "failure",
              "success",
            ]);
            expect(statuses.at(-1)).toMatchObject({
              state: "success",
              description: "All blocking P0/P1 findings resolved",
              reason: "threads-resolved",
            });
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("PR code-review prior-round policy and P0/P1 veto retention", () => {
  test("priorRoundCompleted: passes immediately with 0 P0s without requesting review, while a standing P0 vetoes with failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const statusesBySha = new Map<string, PostCodeReviewCommitStatusInput[]>();
    const triggerCalls: TriggerAndObserveProviderInput[] = [];
    let p0Resolved = false;

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          inspectPrReviewContext: async ({ prNumber }) => ({
            ...defaultContext(),
            priorRoundCompleted: true,
            p0VetoCount: prNumber === 402 ? 1 : 0,
            p0VetoSummary:
              prNumber === 402 ? "1 unresolved P0 finding(s) (Codex)" : null,
            completedAtHead:
              prNumber === 403
                ? {
                    providerId: "coderabbit",
                    blockingCount: 1,
                    message: "1 unresolved P0/P1 finding(s) from CodeRabbit",
                  }
                : null,
          }),
          triggerAndObserveProvider: async (call) => {
            triggerCalls.push(call);
            return reviewedObservation();
          },
          verifyAndCheckBlockingThreads: async ({ prNumber }) =>
            prNumber === 402 && !p0Resolved
              ? {
                  active: true,
                  passed: false,
                  failureReason: "p0-veto",
                  description: "1 unresolved P0 finding(s) (Codex)",
                }
              : {
                  active: true,
                  passed: true,
                  failureReason: null,
                  description: "No unresolved P0 findings",
                },
          postCodeReviewCommitStatus: async (status) => {
            const list = statusesBySha.get(status.sha) ?? [];
            list.push(status);
            statusesBySha.set(status.sha, list);
          },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            await executePrReview(workflowClient, 401, "sha-401");

            expect(triggerCalls).toHaveLength(0);
            expect(statusesBySha.get("sha-401")).toEqual([
              expect.objectContaining({
                state: "success",
                description: "Prior round reviewed; no unresolved P0 findings",
                reason: "prior-round",
              }),
            ]);

            const vetoHandle = await startPrReview(
              workflowClient,
              402,
              "sha-402",
            );

            await vi.waitFor(() => {
              expect(
                statusesBySha
                  .get("sha-402")
                  ?.some((s) => s.state === "failure"),
              ).toBe(true);
            });
            expect(statusesBySha.get("sha-402")?.[0]).toMatchObject({
              state: "failure",
              reason: "p0-veto",
            });

            p0Resolved = true;
            await vetoHandle.signal("recheckReview");
            await vetoHandle.result();

            expect(triggerCalls).toHaveLength(0);
            expect(statusesBySha.get("sha-402")?.at(-1)).toMatchObject({
              state: "success",
              reason: "threads-resolved",
            });

            await executePrReview(workflowClient, 403, "sha-403");
            expect(statusesBySha.get("sha-403")).toEqual([
              expect.objectContaining({
                state: "success",
                description: "Prior round reviewed; no unresolved P0 findings",
                reason: "prior-round",
              }),
            ]);
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("PR code-review first-round P0/P1 veto retention", () => {
  test("first-round review with both P0 and P1 retains assignedProvider so resolving P0 still blocks on P1", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const statuses: PostCodeReviewCommitStatusInput[] = [];
    const checkedProviders: (ProviderId | null)[] = [];
    let p0Open = true;
    let p1Open = true;

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          postCodeReviewCommitStatus: async (status) => {
            statuses.push(status);
          },
          triggerAndObserveProvider: async () => ({
            ...reviewedObservation(),
            p0VetoCount: 1,
            p0VetoMessage: "1 unresolved P0 finding(s) (CodeRabbit)",
            decisionState: "failed",
            decisionMessage: "2 unresolved P0/P1 findings",
            blockingCount: 2,
          }),
          verifyAndCheckBlockingThreads: async ({ providerId }) => {
            checkedProviders.push(providerId);
            if (p0Open) {
              return {
                active: true,
                passed: false,
                failureReason: "p0-veto",
                description: "1 unresolved P0 finding(s) (CodeRabbit)",
              };
            }
            if (providerId !== null && p1Open) {
              return {
                active: true,
                passed: false,
                failureReason: "blocking-findings",
                description: "1 unresolved P0/P1 finding(s) from CodeRabbit",
              };
            }
            return {
              active: true,
              passed: true,
              failureReason: null,
              description: "CodeRabbit reviewed clean",
            };
          },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            const handle = await startPrReview(workflowClient, 410, "sha-410");

            await vi.waitFor(() => {
              expect(
                statuses.some(
                  (s) => s.state === "failure" && s.reason === "p0-veto",
                ),
              ).toBe(true);
            });

            p0Open = false;
            await handle.signal("recheckReview");

            await vi.waitFor(() => {
              expect(
                statuses.some(
                  (s) =>
                    s.state === "failure" &&
                    s.description.includes(
                      "1 unresolved P0/P1 finding(s) from CodeRabbit",
                    ),
                ),
              ).toBe(true);
            });
            expect(statuses.some((s) => s.state === "success")).toBe(false);

            p1Open = false;
            await handle.signal("recheckReview");
            await handle.result();

            expect(checkedProviders.every((id) => id === "coderabbit")).toBe(
              true,
            );
            expect(statuses.at(-1)).toMatchObject({
              state: "success",
              reason: "threads-resolved",
            });
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("codeReviewCoordinatorWorkflow continueAsNew", () => {
  test("coordinator resets processedCount across continueAsNew while preserving weighted state", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const coordinatorObserved = new Map<number, ProviderId[]>();

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          triggerAndObserveProvider: async (call) => {
            recordObservedProvider(coordinatorObserved, call);
            return reviewedObservation();
          },
        }),
        execute: async () => {
          const workflowClient = realTimeWorkflowClient(environment);
          try {
            const coordHandle = await workflowClient.start(
              "codeReviewCoordinatorWorkflow",
              {
                workflowId: CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
                taskQueue: TASK_QUEUES.WORKFLOWS,
                args: [
                  {
                    weighted: { currentWeights: {}, cooldownUntilMs: {} },
                    processedCount: 499,
                  },
                ],
              },
            );
            const initialDesc = await coordHandle.describe();

            await executePrReview(workflowClient, 420, "sha-420");

            const latestHandle = workflowClient.getHandle(
              CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
            );
            let continuedRunId = initialDesc.runId;
            await vi.waitFor(async () => {
              const desc = await latestHandle.describe();
              expect(desc.runId).not.toBe(initialDesc.runId);
              continuedRunId = desc.runId;
            });

            await executePrReview(workflowClient, 421, "sha-421");
            await executePrReview(workflowClient, 422, "sha-422");

            const afterFollowupDesc = await latestHandle.describe();
            expect(afterFollowupDesc.runId).toBe(continuedRunId);
            expect(coordinatorObserved.get(420)).toEqual(["coderabbit"]);
            expect([
              ...(coordinatorObserved.get(421) ?? []),
              ...(coordinatorObserved.get(422) ?? []),
            ]).toContain("codex");
          } finally {
            await terminateCoordinatorIfRunning(environment);
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});

describe("backfillOpenPrCodeReviewsWorkflow", () => {
  test("starts prCodeReviewWorkflow for every open non-draft PR targeting main", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const startedPrs: number[] = [];

    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.CODE_REVIEW,
        activities: buildCoordinatorBridgeActivities(environment, {
          listOpenMainPrsForCodeReview: async () => [
            { prNumber: 501, headSha: "sha-501", baseRef: "main" },
            { prNumber: 502, headSha: "sha-502", baseRef: "main" },
          ],
          startPrCodeReviewWorkflow: async (input) => {
            startedPrs.push(input.prNumber);
          },
        }),
        execute: async () => {
          const result = await environment.client.workflow.execute(
            "backfillOpenPrCodeReviewsWorkflow",
            {
              workflowId: "backfill-open-pr-code-reviews-test",
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [{ owner: "shepherdjerred", repo: "monorepo" }],
            },
          );
          expect(result).toEqual({
            startedCount: 2,
            prNumbers: [501, 502],
          });
          expect(startedPrs).toEqual([501, 502]);
        },
      });
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
