/**
 * One-shot trigger for the homelab-audit workflow against any Temporal server
 * (local dev or production). Used in Layer 5 of the verification ladder, after
 * the prompt is dialed in via Layer 2.
 *
 * Usage (local dev — temporal server start-dev):
 *   temporal server start-dev --ui-port 8233 &
 *   op run --env-file=.env.audit -- TEMPORAL_ADDRESS=localhost:7233 \
 *     bun run start &
 *   op run --env-file=.env.audit -- TEMPORAL_ADDRESS=localhost:7233 \
 *     bun run scripts/trigger-homelab-audit.ts
 *
 * Usage (production — kubectl port-forward):
 *   kubectl -n temporal port-forward svc/temporal-server 7233:7233 &
 *   TEMPORAL_ADDRESS=localhost:7233 bun run scripts/trigger-homelab-audit.ts
 *
 * Flags:
 *   --date=YYYY-MM-DD   override the audit date (default: today UTC)
 *   --no-wait           start the workflow and exit; don't tail it
 */
import { Client, Connection } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

type Args = { date: string; wait: boolean };

function parseArgs(argv: readonly string[]): Args {
  let date = new Date().toISOString().slice(0, 10);
  let wait = true;
  for (const arg of argv) {
    if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
    } else if (arg === "--no-wait") {
      wait = false;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { date, wait };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });
  const workflowId = `homelab-audit-trigger-${args.date}-${crypto.randomUUID().slice(0, 8)}`;

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Starting homelab audit workflow",
      workflowId,
      date: args.date,
      address,
    }),
  );

  const handle = await client.workflow.start("runHomelabAuditWorkflow", {
    args: [{ date: args.date }],
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowId,
    workflowExecutionTimeout: "60 minutes",
  });

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Workflow started",
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    }),
  );

  if (!args.wait) {
    return;
  }

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Waiting for workflow to complete (this can take 25–45 min)...",
    }),
  );
  const startMs = Date.now();
  await handle.result();
  const elapsedSec = Math.round((Date.now() - startMs) / 1000);
  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Workflow completed",
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
      elapsedSec,
    }),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
