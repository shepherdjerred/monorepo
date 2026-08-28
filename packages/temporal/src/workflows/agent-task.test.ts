import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { RunAgentTaskResultV2 } from "#shared/agent-task-result-types.ts";
import type { SendAgentTaskFailureReportInput } from "#activities/agent-task-side-activities.ts";
import { AgentTaskInputSchema } from "#shared/agent-task.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { agentTaskWorkflow } from "./index.ts";
import {
  agentActivityRetryFor,
  agentTaskFailureStageFor,
} from "./agent-task.ts";

const INPUT = AgentTaskInputSchema.parse({
  contractVersion: 2,
  title: "Inspect production evidence",
  prompt: "Inspect the declared evidence and schedule a follow-up.",
  checks: [
    {
      id: "production-evidence",
      label: "Production evidence",
      required: true,
      evidenceRequirement: "Capture the typed production status.",
      evidenceCollectors: [
        {
          id: "typed-production-status",
          kind: "command",
          argv: ["runtime-status", "--json"],
          output: "json",
          expectation: { kind: "exit-code", passedExitCodes: [0] },
        },
      ],
    },
  ],
  provider: "claude",
  mode: "report-only",
  repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
});

const RESULT: RunAgentTaskResultV2 = {
  contractVersion: 2,
  provider: "claude",
  model: "claude-sonnet-4-5",
  durationMs: 1000,
  startedAt: "2026-08-10T12:00:00.000Z",
  evidence: [
    {
      id: "collector:production-evidence:typed-production-status",
      source: "declared-command:typed-production-status",
      origin: "declared-collector",
      observedAt: "2026-08-10T12:00:30.000Z",
      status: "success",
      semanticStatus: "passed",
      excerpt: "Production is healthy.",
    },
  ],
  payload: {
    headline: "Production evidence is healthy.",
    checks: [
      {
        id: "production-evidence",
        status: "passed",
        summary: "Production is healthy.",
        evidenceReceiptIds: [
          "collector:production-evidence:typed-production-status",
        ],
      },
    ],
    findings: [],
    limitations: [],
    actions: [],
    followUp: {
      title: "Recheck production evidence",
      prompt: "Inspect the production status again.",
      runAt: "2026-08-12T12:00:00.000Z",
    },
  },
};

const RESULT_WITHOUT_FOLLOW_UP: RunAgentTaskResultV2 = {
  ...RESULT,
  payload: {
    headline: RESULT.payload.headline,
    checks: RESULT.payload.checks,
    findings: RESULT.payload.findings,
    limitations: RESULT.payload.limitations,
    actions: RESULT.payload.actions,
  },
};

let testEnvironment: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnvironment.teardown();
});

async function runAgentTaskExpectingFailure(
  activities: NonNullable<WorkerOptions["activities"]>,
  workflowIdPrefix: string,
): Promise<unknown> {
  const workflowWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
  });
  const agentWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUES.AGENT_TASK,
    activities,
  });
  const reportWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: TASK_QUEUES.REPORTS,
    activities,
  });
  const agentWorkerRun = agentWorker.run();
  const reportWorkerRun = reportWorker.run();

  try {
    await workflowWorker.runUntil(
      testEnvironment.client.workflow.execute(agentTaskWorkflow, {
        args: [INPUT],
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowId: `${workflowIdPrefix}-${crypto.randomUUID()}`,
      }),
    );
    return undefined;
  } catch (error: unknown) {
    return error;
  } finally {
    agentWorker.shutdown();
    reportWorker.shutdown();
    await agentWorkerRun;
    await reportWorkerRun;
  }
}

describe("agentActivityRetryFor", () => {
  test("keeps the default retry policy for unbounded agent tasks", () => {
    expect(agentActivityRetryFor({})).toEqual({
      maximumAttempts: 2,
      initialInterval: "1 minute",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    });
  });

  test("uses a single attempt for bounded agent tasks", () => {
    expect(agentActivityRetryFor({ agentTimeoutMinutes: 8 })).toEqual({
      maximumAttempts: 1,
    });
  });
});

describe("agentTaskFailureStageFor", () => {
  test("preserves old history ordering when the post-delivery patch is absent", () => {
    expect(
      agentTaskFailureStageFor({
        v2Reporting: true,
        reportAttempted: true,
        reportDelivered: true,
        postDeliveryFailureReporting: false,
      }),
    ).toBeUndefined();
  });

  test("enables follow-up failure reporting for patched executions", () => {
    expect(
      agentTaskFailureStageFor({
        v2Reporting: true,
        reportAttempted: true,
        reportDelivered: true,
        postDeliveryFailureReporting: true,
      }),
    ).toBe("follow-up-dispatch");
  });
});

describe("agent task post-report failure delivery", () => {
  test("sends a distinct failure report before rethrowing a follow-up dispatch failure", async () => {
    const events: string[] = [];
    const failureReports: SendAgentTaskFailureReportInput[] = [];
    let followUpAttempts = 0;
    const activities = {
      prepareAgentTaskWorkdir: () => ({ workdir: "/tmp/agent-task-test" }),
      runAgentTask: () => RESULT,
      investigateAgentTask: () => RESULT,
      finalizeAgentTask: () => RESULT,
      sendAgentTaskEmail: () => {
        events.push("success-report");
        return {
          subject: "[OK] Agent Task: Inspect production evidence",
          messageId: "success-message",
          recipientId: 1,
          reportRunId: "agent-task:run-1",
          receiptKey: "reports/receipts/agent-task/run-1.json",
        };
      },
      scheduleAgentTaskFollowUp: (): never => {
        followUpAttempts += 1;
        events.push("follow-up-failed");
        throw new Error("follow-up schedule unavailable");
      },
      sendAgentTaskFailureReport: (input: SendAgentTaskFailureReportInput) => {
        failureReports.push(input);
        events.push("failure-report");
        return {
          subject: "[FAILED] Agent Task: Inspect production evidence",
          messageId: "failure-message",
          recipientId: 1,
          reportRunId: "agent-task:run-1:failed",
          receiptKey: "reports/receipts/agent-task/run-1-failed.json",
        };
      },
      cleanupAgentTaskWorkdir: () => {
        events.push("cleanup");
      },
    };
    const failure = await runAgentTaskExpectingFailure(
      activities,
      "agent-task-follow-up-failure",
    );

    expect(failure).toBeInstanceOf(Error);
    expect(followUpAttempts).toBe(2);
    expect(events).toEqual([
      "success-report",
      "follow-up-failed",
      "follow-up-failed",
      "failure-report",
      "cleanup",
    ]);
    expect(failureReports).toHaveLength(1);
    expect(failureReports[0]).toMatchObject({
      input: INPUT,
      failureStage: "follow-up-dispatch",
      error: expect.stringContaining("follow-up schedule unavailable"),
    });
  }, 30_000);

  test("reports a cleanup failure after an otherwise successful result", async () => {
    const events: string[] = [];
    const failureReports: SendAgentTaskFailureReportInput[] = [];
    let cleanupAttempts = 0;
    const activities = {
      prepareAgentTaskWorkdir: () => ({ workdir: "/tmp/agent-task-test" }),
      runAgentTask: () => RESULT_WITHOUT_FOLLOW_UP,
      investigateAgentTask: () => RESULT_WITHOUT_FOLLOW_UP,
      finalizeAgentTask: () => RESULT_WITHOUT_FOLLOW_UP,
      sendAgentTaskEmail: () => {
        events.push("success-report");
        return {
          subject: "[OK] Agent Task: Inspect production evidence",
          messageId: "success-message",
          recipientId: 1,
          reportRunId: "agent-task:run-2",
          receiptKey: "reports/receipts/agent-task/run-2.json",
        };
      },
      scheduleAgentTaskFollowUp: (): never => {
        throw new Error("unexpected follow-up dispatch");
      },
      sendAgentTaskFailureReport: (input: SendAgentTaskFailureReportInput) => {
        failureReports.push(input);
        events.push("failure-report");
        return {
          subject: "[FAILED] Agent Task: Inspect production evidence",
          messageId: "failure-message",
          recipientId: 1,
          reportRunId: "agent-task:run-2:failed",
          receiptKey: "reports/receipts/agent-task/run-2-failed.json",
        };
      },
      cleanupAgentTaskWorkdir: (): never => {
        cleanupAttempts += 1;
        events.push("cleanup-failed");
        throw new Error("workdir cleanup unavailable");
      },
    };
    const failure = await runAgentTaskExpectingFailure(
      activities,
      "agent-task-cleanup-failure",
    );

    expect(failure).toBeInstanceOf(Error);
    expect(cleanupAttempts).toBe(2);
    expect(events).toEqual([
      "success-report",
      "cleanup-failed",
      "cleanup-failed",
      "failure-report",
    ]);
    expect(failureReports[0]).toMatchObject({
      input: INPUT,
      failureStage: "workdir-cleanup",
      error: expect.stringContaining("workdir cleanup unavailable"),
    });
  }, 30_000);
});
