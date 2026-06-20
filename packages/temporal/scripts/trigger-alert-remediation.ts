/**
 * One-shot trigger for a SINGLE alert-remediation child workflow against any
 * Temporal server (local dev or production). Lets you exercise the full
 * worker → child workflow → runAlertRemediationAgent → claude(stream-json)
 * loop against ONE synthetic alert, without waiting for the hourly sweep.
 *
 * Usage (local dev — real local Temporal + real claude):
 *   temporal server start-dev --ui-port 8233 &
 *   op run --env-file=.env.alert-remediation -- TEMPORAL_ADDRESS=localhost:7233 \
 *     bun run start &                       # the worker (polls agent-task queue)
 *   op run --env-file=.env.alert-remediation -- TEMPORAL_ADDRESS=localhost:7233 \
 *     bun run scripts/trigger-alert-remediation.ts --title="disk SMART warning"
 *
 * Watch the worker logs for `phase=agent-event` (live per-turn NDJSON) and
 * `phase=exited`. Terminate the workflow from the Temporal UI (localhost:8233)
 * to observe the cancellation → soft-kill → SIGKILL escalation path.
 *
 * Flags:
 *   --source=pagerduty|bugsink   alert source (default: pagerduty)
 *   --fingerprint=<id>           unique-within-source id (default: local-test)
 *   --title=<text>               alert title (default: "local test alert")
 *   --provider=claude|codex      agent provider (default: claude)
 *   --model=<id>                 model override (default: provider default)
 *   --max-turns=<n>              agent max turns (default: 15)
 *   --ref=<git-ref>              base ref (default: main)
 *   --no-wait                    start and exit; don't tail the result
 */
import { Client, Connection } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DEFAULT_TEMPORAL_ADDRESS = "localhost:7233";

type Args = {
  source: "pagerduty" | "bugsink";
  fingerprint: string;
  title: string;
  provider: "claude" | "codex";
  model: string | undefined;
  maxTurns: number;
  ref: string;
  wait: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    source: "pagerduty",
    fingerprint: "local-test",
    title: "local test alert",
    provider: "claude",
    model: undefined,
    maxTurns: 15,
    ref: "main",
    wait: true,
  };
  for (const arg of argv) {
    if (arg === "--source=bugsink") {
      args.source = "bugsink";
    } else if (arg === "--source=pagerduty") {
      args.source = "pagerduty";
    } else if (arg.startsWith("--fingerprint=")) {
      args.fingerprint = arg.slice("--fingerprint=".length);
    } else if (arg.startsWith("--title=")) {
      args.title = arg.slice("--title=".length);
    } else if (arg === "--provider=codex") {
      args.provider = "codex";
    } else if (arg === "--provider=claude") {
      args.provider = "claude";
    } else if (arg.startsWith("--model=")) {
      args.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--max-turns=")) {
      args.maxTurns = Number(arg.slice("--max-turns=".length));
    } else if (arg.startsWith("--ref=")) {
      args.ref = arg.slice("--ref=".length);
    } else if (arg === "--no-wait") {
      args.wait = false;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });
  const workflowId = `alert-remediation-trigger-${args.source}-${crypto.randomUUID().slice(0, 8)}`;

  const input = {
    alert: {
      source: args.source,
      fingerprint: `${args.source}:${args.fingerprint}`,
      title: args.title,
      status: "triggered",
      severity: "high",
      details: { note: "Synthetic alert from trigger-alert-remediation.ts" },
    },
    repo: { fullName: "shepherdjerred/monorepo", ref: args.ref },
    provider: args.provider,
    model: args.model,
    maxTurns: args.maxTurns,
  };

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Starting alert-remediation child workflow",
      workflowId,
      address,
      taskQueue: TASK_QUEUES.AGENT_TASK,
      input,
    }),
  );

  const handle = await client.workflow.start("alertRemediationChildWorkflow", {
    taskQueue: TASK_QUEUES.AGENT_TASK,
    workflowId,
    args: [input],
  });

  console.warn(`Started ${workflowId}. Temporal UI: http://localhost:8233`);
  if (!args.wait) {
    return;
  }
  const result: unknown = await handle.result();
  console.warn(
    JSON.stringify({ level: "info", msg: "Result", result }, null, 2),
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
