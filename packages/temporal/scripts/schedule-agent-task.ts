/**
 * Schedule a one-off or recurring generic agent task.
 *
 * Examples:
 *   TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc packages/docs/guides/foo.md
 *   bun run scripts/schedule-agent-task.ts --json '{"title":"Check thing",...}'
 */
import { Client, Connection } from "@temporalio/client";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskInput,
} from "#shared/agent-task.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";
const BLOCK_START = "<!-- temporal-agent-task";
const BLOCK_END = "-->";

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

function extractBlock(markdown: string): string {
  const start = markdown.indexOf(BLOCK_START);
  if (start === -1) {
    throw new Error(`No ${BLOCK_START} block found`);
  }
  const jsonStart = start + BLOCK_START.length;
  const end = markdown.indexOf(BLOCK_END, jsonStart);
  if (end === -1) {
    throw new Error(`Unclosed ${BLOCK_START} block`);
  }
  return markdown.slice(jsonStart, end).trim();
}

async function loadInput(args: Args): Promise<AgentTaskInput> {
  if (args.kind === "doc") {
    const text = await Bun.file(args.path).text();
    return AgentTaskInputSchema.parse(JSON.parse(extractBlock(text)));
  }
  if (args.kind === "json") {
    return AgentTaskInputSchema.parse(JSON.parse(args.value));
  }
  const text = await new Response(Bun.stdin.stream()).text();
  return AgentTaskInputSchema.parse(JSON.parse(text));
}

async function main(): Promise<void> {
  const input = await loadInput(parseArgs(process.argv.slice(2)));
  const address = Bun.env["TEMPORAL_ADDRESS"] ?? DEFAULT_TEMPORAL_ADDRESS;
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });
  const result = await startOrScheduleAgentTask(client, input);
  console.warn(JSON.stringify(result, null, 2));
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
})();
