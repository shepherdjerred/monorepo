import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { alertRemediationSweepWorkflow } from "./alert-remediation.ts";
import type {
  AlertRemediationChildResult,
  NormalizedAlert,
} from "#shared/alert-remediation.ts";

const TASK_QUEUE = "alert-remediation-test";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

function alert(fingerprint: string): NormalizedAlert {
  return {
    source: "pagerduty",
    fingerprint,
    title: `Alert ${fingerprint}`,
    status: "triggered",
    severity: "high",
    url: `https://example.com/${fingerprint}`,
    details: {},
  };
}

function reportOnlyResult(input: {
  fingerprint: string;
  title: string;
}): AlertRemediationChildResult {
  return {
    source: "pagerduty",
    fingerprint: input.fingerprint,
    title: input.title,
    outcome: "report-only",
    decision: "diagnosed",
    reason: "No repository fix needed.",
    markdown: "Diagnosis only.",
    verificationCommands: [],
  };
}

describe("alertRemediationSweepWorkflow", () => {
  it("dedupes alerts, fans out children, and caps concurrency", async () => {
    let activeAgents = 0;
    let maxActiveAgents = 0;
    const calls = {
      prepare: 0,
      agent: 0,
      email: 0,
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectAlertRemediationAlerts: async () => ({
          alerts: [
            alert("pagerduty:A"),
            alert("pagerduty:A"),
            alert("pagerduty:B"),
            alert("pagerduty:C"),
            alert("pagerduty:D"),
          ],
          failures: [],
        }),
        findExistingAlertRemediationPr: async () => ({ found: false }),
        prepareAlertRemediationWorkdir: async () => {
          calls.prepare += 1;
          return { workdir: "/tmp/alert-remediation-test" };
        },
        runAlertRemediationAgent: async (input: {
          input: { alert: NormalizedAlert };
        }) => {
          calls.agent += 1;
          activeAgents += 1;
          maxActiveAgents = Math.max(maxActiveAgents, activeAgents);
          await Bun.sleep(20);
          activeAgents -= 1;
          return reportOnlyResult({
            fingerprint: input.input.alert.fingerprint,
            title: input.input.alert.title,
          });
        },
        cleanupAlertRemediationWorkdir: async () => {
          await Promise.resolve();
        },
        sendAlertRemediationSweepEmail: async () => {
          calls.email += 1;
          return { sent: true, subject: "x", messageId: "m" };
        },
      },
    });

    const result = await worker.runUntil(
      testEnv.client.workflow.execute(alertRemediationSweepWorkflow, {
        args: [
          {
            repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
            provider: "claude",
            concurrency: 2,
            maxTurns: 20,
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId: "alert-remediation-sweep-fanout",
      }),
    );

    expect(result.inspectedAlerts).toBe(5);
    expect(result.startedChildren).toBe(4);
    expect(result.skippedDuplicateAlerts).toBe(1);
    expect(result.outcomes).toHaveLength(4);
    expect(calls.prepare).toBe(4);
    expect(calls.agent).toBe(4);
    expect(maxActiveAgents).toBeLessThanOrEqual(2);
    expect(calls.email).toBe(0);
    expect(result.emailSent).toBe(false);
  }, 60_000);

  it("isolates child failures and sends a summary email", async () => {
    let emailCalls = 0;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectAlertRemediationAlerts: async () => ({
          alerts: [alert("pagerduty:failure")],
          failures: [],
        }),
        findExistingAlertRemediationPr: async () => ({ found: false }),
        prepareAlertRemediationWorkdir: async () => ({
          workdir: "/tmp/alert-remediation-test",
        }),
        runAlertRemediationAgent: async () => {
          throw new Error("simulated remediation failure");
        },
        cleanupAlertRemediationWorkdir: async () => {
          await Promise.resolve();
        },
        sendAlertRemediationSweepEmail: async () => {
          emailCalls += 1;
          return { sent: true, subject: "x", messageId: "m" };
        },
      },
    });

    const result = await worker.runUntil(
      testEnv.client.workflow.execute(alertRemediationSweepWorkflow, {
        args: [
          {
            repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
            provider: "claude",
            concurrency: 3,
            maxTurns: 20,
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId: "alert-remediation-sweep-failure",
      }),
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.outcome).toBe("failed");
    expect(result.outcomes[0]?.reason).toContain("Activity task failed");
    expect(emailCalls).toBe(1);
    expect(result.emailSent).toBe(true);
  }, 60_000);

  it("skips agent work when an open remediation PR already exists", async () => {
    let agentCalls = 0;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
      activities: {
        collectAlertRemediationAlerts: async () => ({
          alerts: [alert("pagerduty:covered")],
          failures: [],
        }),
        findExistingAlertRemediationPr: async () => ({
          found: true,
          prUrl: "https://github.com/shepherdjerred/monorepo/pull/1",
          branchName: "alert-remediation/pagerduty/covered",
          title: "fix(alert): covered",
        }),
        prepareAlertRemediationWorkdir: async () => {
          throw new Error("prepare should not run");
        },
        runAlertRemediationAgent: async () => {
          agentCalls += 1;
          throw new Error("agent should not run");
        },
        cleanupAlertRemediationWorkdir: async () => {
          await Promise.resolve();
        },
        sendAlertRemediationSweepEmail: async () => ({
          sent: true,
          subject: "x",
          messageId: "m",
        }),
      },
    });

    const result = await worker.runUntil(
      testEnv.client.workflow.execute(alertRemediationSweepWorkflow, {
        args: [
          {
            repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
            provider: "claude",
            concurrency: 3,
            maxTurns: 20,
          },
        ],
        taskQueue: TASK_QUEUE,
        workflowId: "alert-remediation-sweep-covered",
      }),
    );

    expect(result.outcomes[0]?.outcome).toBe("already-covered");
    expect(result.outcomes[0]?.prUrl).toBe(
      "https://github.com/shepherdjerred/monorepo/pull/1",
    );
    expect(agentCalls).toBe(0);
  }, 60_000);
});
