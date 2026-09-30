/**
 * Run real v2 success, partial, and failure reports through the production
 * agent-task queue. The operator must confirm all three tagged emails plus the
 * matching Temporal and S3 report state before accepting a rollout.
 */
import { Client, Connection } from "@temporalio/client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import {
  AgentTaskInputV2Schema,
  type AgentTaskInputV2,
  type AgentTaskStartResult,
} from "#shared/agent/agent-task.ts";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

function requireProductionInvocation(): void {
  if (!process.argv.slice(2).includes("--production-only")) {
    throw new Error(
      "The report reliability canary is production-only; run bun run canary:report-reliability",
    );
  }
  if (Bun.env["TEMPORAL_TLS"] !== "true") {
    throw new Error(
      "TEMPORAL_TLS=true is required for the report reliability canary",
    );
  }
}

function workflowResultOrThrow(result: AgentTaskStartResult): {
  workflowId: string;
  runId: string;
} {
  if (result.kind !== "workflow") {
    throw new Error(
      "Report reliability canary unexpectedly created a schedule",
    );
  }
  return { workflowId: result.workflowId, runId: result.runId };
}

function canaryInput(
  name: "success" | "partial" | "failure",
): AgentTaskInputV2 {
  const shared = {
    contractVersion: 2,
    title: `Report reliability ${name} canary`,
    provider: "claude",
    mode: "report-only",
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    maxTurns: 4,
    agentTimeoutMinutes: 10,
    idempotencyKey: `report-reliability-${name}-${crypto.randomUUID()}`,
    emailSubjectPrefix: `[report-v2-canary:${name}]`,
  } as const;
  if (name === "failure") {
    return AgentTaskInputV2Schema.parse({
      ...shared,
      model: "report-reliability-intentionally-invalid-model",
      prompt: "This run must fail before finalization.",
      checks: [
        {
          id: "intentional-failure",
          label: "Intentional provider failure",
          required: true,
          evidenceRequirement: "A provider execution result.",
          evidenceCollectors: [
            {
              id: "provider-execution-sentinel",
              kind: "command",
              argv: ["printf", String.raw`provider-execution-sentinel\n`],
              output: "non-empty",
              expectation: { kind: "exit-code", passedExitCodes: [0] },
            },
          ],
        },
      ],
    });
  }
  const partial = name === "partial";
  return AgentTaskInputV2Schema.parse({
    ...shared,
    prompt: partial
      ? "Use Bash to run `printf 'partial-canary-ok\\n'`. Pass receipt-check with collector:receipt-check:receipt-sentinel. Mark unavailable-check skipped with collector:unavailable-check:unavailable-sentinel and state the failed collector limitation."
      : "Use Bash to run `printf 'success-canary-ok\\n'`. Pass receipt-check with collector:receipt-check:receipt-sentinel and return no findings, limitations, actions, follow-up, synthesis, or retirement recommendation.",
    checks: [
      {
        id: "receipt-check",
        label: "Provider receipt extraction",
        required: true,
        evidenceRequirement: `A successful Bash receipt containing ${name}-canary-ok.`,
        evidenceCollectors: [
          {
            id: "receipt-sentinel",
            kind: "command",
            argv: ["printf", String.raw`${name}-canary-ok\n`],
            output: "non-empty",
            expectation: { kind: "exit-code", passedExitCodes: [0] },
          },
        ],
      },
      ...(partial
        ? [
            {
              id: "unavailable-check",
              label: "Intentionally unavailable evidence",
              required: true,
              evidenceRequirement:
                "Evidence intentionally unavailable for partial-path validation.",
              evidenceCollectors: [
                {
                  id: "unavailable-sentinel",
                  kind: "command" as const,
                  argv: ["false"],
                  output: "allow-empty" as const,
                  expectation: {
                    kind: "exit-code" as const,
                    passedExitCodes: [0],
                  },
                },
              ],
            },
          ]
        : []),
    ],
  });
}

async function runCanary(
  client: Client,
  name: "success" | "partial" | "failure",
): Promise<void> {
  const input = canaryInput(name);
  const started = workflowResultOrThrow(
    await startOrScheduleAgentTask(client, input),
  );
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Report reliability canary started",
      name,
      ...started,
      emailSubjectPrefix: input.emailSubjectPrefix,
    }),
  );
  const handle = client.workflow.getHandle(started.workflowId, started.runId);
  if (name === "failure") {
    try {
      await handle.result();
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "info",
          msg: "Failure canary failed after sending its report as expected",
          workflowId: started.workflowId,
          runId: started.runId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    throw new Error("Failure canary unexpectedly completed successfully");
  }
  await handle.result();
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Report reliability canary completed",
      name,
      ...started,
    }),
  );
}

async function main(): Promise<void> {
  requireProductionInvocation();
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  if (namespace !== "prod") {
    throw new Error("The report reliability canary requires prod namespace");
  }
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: address,
    }),
  );
  const client = new Client({ connection, namespace });
  for (const name of ["success", "partial", "failure"] as const) {
    await runCanary(client, name);
  }
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Confirm the three tagged emails, Temporal states, S3 report states, and report metrics before accepting the rollout",
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
