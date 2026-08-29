/**
 * Run one real report-only Claude agent task through the production queue.
 * This is intentionally an operator command: it sends one tagged email and
 * must only be run after the worker image has been deployed.
 *
 * Usage:
 *   bun run canary:agent-task
 */
import { Client, Connection } from "@temporalio/client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import {
  AgentTaskInputV2Schema,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

function requireProductionInvocation(): void {
  if (!process.argv.slice(2).includes("--production-only")) {
    throw new Error(
      "The structured-output canary is production-only; run bun run canary:agent-task",
    );
  }
  if (Bun.env["TEMPORAL_TLS"] !== "true") {
    throw new Error(
      "TEMPORAL_TLS=true is required for the production structured-output canary",
    );
  }
}

function workflowResultOrThrow(result: AgentTaskStartResult): {
  workflowId: string;
  runId: string;
} {
  if (result.kind !== "workflow") {
    throw new Error("Structured-output canary unexpectedly created a schedule");
  }
  return { workflowId: result.workflowId, runId: result.runId };
}

async function main(): Promise<void> {
  requireProductionInvocation();
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const input = AgentTaskInputV2Schema.parse({
    contractVersion: 2,
    title: "Agent-task structured-output canary",
    prompt:
      "Use Bash to run `printf 'agent-task-canary-ok\\n'` to exercise provider receipt extraction. Report the declared check exactly once and cite collector:structured-output:canary-sentinel. Return no synthesis.",
    provider: "claude",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    checks: [
      {
        id: "structured-output",
        label: "Structured output and evidence",
        required: true,
        evidenceRequirement:
          "A successful Bash receipt containing agent-task-canary-ok.",
        evidenceCollectors: [
          {
            id: "canary-sentinel",
            kind: "command",
            argv: ["printf", String.raw`agent-task-canary-ok\n`],
            output: "non-empty",
            expectation: { kind: "exit-code", passedExitCodes: [0] },
          },
        ],
      },
    ],
    maxTurns: 2,
    agentTimeoutMinutes: 10,
    idempotencyKey: `agent-task-structured-output-canary-${crypto.randomUUID()}`,
    emailSubjectPrefix: "[agent-task-canary]",
  });

  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: address,
    }),
  );
  const client = new Client({ connection });
  const started = workflowResultOrThrow(
    await startOrScheduleAgentTask(client, input),
  );
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Agent-task structured-output canary started",
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowId: started.workflowId,
      runId: started.runId,
      emailSubjectPrefix: input.emailSubjectPrefix,
    }),
  );

  await client.workflow.getHandle(started.workflowId, started.runId).result();
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Agent-task structured-output canary completed",
      workflowId: started.workflowId,
      runId: started.runId,
      expected: "structured_output parsed and tagged report-only email sent",
    }),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
})();
