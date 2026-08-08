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
  AgentTaskInputSchema,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

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
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const input = AgentTaskInputSchema.parse({
    title: "Agent-task structured-output canary",
    prompt:
      "Do not use tools. Return a short report confirming that the structured-output canary reached the Claude parser. Include exactly one sentence in markdown.",
    provider: "claude",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    maxTurns: 2,
    agentTimeoutMinutes: 10,
    idempotencyKey: `agent-task-structured-output-canary-${crypto.randomUUID()}`,
    emailSubjectPrefix: "[agent-task-canary]",
    allowSelfCancel: false,
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
      taskQueue: "agent-task",
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
