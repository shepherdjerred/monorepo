/**
 * Schedule one or more one-off or recurring generic agent tasks.
 *
 * Examples:
 *   TEMPORAL_ADDRESS=localhost:7233 TEMPORAL_NAMESPACE=dev bun run scripts/schedule-agent-task.ts --from-doc /tmp/agent-task.md
 *   // --from-doc validates every temporal-agent-task block, then schedules them in document order.
 *   bun run scripts/schedule-agent-task.ts --json '{"title":"Check thing",...}'
 */
import { Client, Connection } from "@temporalio/client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import {
  AgentTaskInputV2Schema,
  type AgentTaskInput,
} from "#shared/agent-task.ts";
import { parseAgentTaskInputsFromMarkdown } from "#lib/agent-task-markdown.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { parseTemporalNamespace } from "#shared/temporal-namespace.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";
type Args =
  | { kind: "doc"; path: string }
  | { kind: "json"; value: string }
  | { kind: "stdin" };

function usage(): never {
  console.error(
    [
      "Usage:",
      "  bun run scripts/schedule-agent-task.ts --from-doc <path>",
      "  bun run scripts/schedule-agent-task.ts --json '<json>'",
      "  bun run scripts/schedule-agent-task.ts --stdin",
    ].join("\n"),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  if (argv.length === 2 && argv[0] === "--from-doc") {
    const path = argv[1];
    if (path === undefined || path.length === 0) {
      usage();
    }
    return { kind: "doc", path };
  }
  if (argv.length === 2 && argv[0] === "--json") {
    const value = argv[1];
    if (value === undefined || value.length === 0) {
      usage();
    }
    return { kind: "json", value };
  }
  if (argv.length === 1 && argv[0] === "--stdin") {
    return { kind: "stdin" };
  }
  usage();
}

async function loadInputs(args: Args): Promise<AgentTaskInput[]> {
  if (args.kind === "doc") {
    const text = await Bun.file(args.path).text();
    return parseAgentTaskInputsFromMarkdown(text);
  }
  if (args.kind === "json") {
    return [AgentTaskInputV2Schema.parse(JSON.parse(args.value))];
  }
  const text = await new Response(Bun.stdin.stream()).text();
  return [AgentTaskInputV2Schema.parse(JSON.parse(text))];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs(args);
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: DEFAULT_TEMPORAL_ADDRESS,
    }),
  );
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  const client = new Client({ connection, namespace });
  const results = [];
  for (const input of inputs) {
    results.push(
      await startOrScheduleAgentTask(
        client,
        input,
        args.kind === "doc" ? { reuseExistingWorkflow: true } : undefined,
      ),
    );
  }
  console.warn(
    JSON.stringify(results.length === 1 ? results[0] : results, null, 2),
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
