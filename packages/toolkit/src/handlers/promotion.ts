import { parseArgs } from "node:util";

const USAGE = `toolkit promotion <status|preview|run|pause|resume|reconcile> [target] [--json] [--dry-run]

status, pause and resume accept an omitted target for all known destinations.
preview, run and reconcile require one exact target ID.
All commands address the production Temporal namespace. Manual runs retain
the same posting limits and buffered cooldown as scheduled runs.
reconcile inspects an uncertain prior attempt and never submits a new post.
--dry-run prints the non-secret native invocation without starting a Workflow.`;

export function promotionInvocation(
  subcommand: string,
  target: string | undefined,
  json: boolean,
): string[] {
  const agentOperation =
    subcommand === "run" ||
    subcommand === "preview" ||
    subcommand === "reconcile";
  if (!agentOperation && !["status", "pause", "resume"].includes(subcommand))
    throw new Error(`Unknown promotion command: ${subcommand}`);
  if (target !== undefined && !/^[a-z0-9-]+$/.test(target))
    throw new Error("Expected an exact promotion target ID");
  if (agentOperation && target === undefined)
    throw new Error(`${subcommand} requires a target`);
  const workflowId = agentOperation
    ? `storm-promotion/${target ?? ""}`
    : `storm-promotion/control/${crypto.randomUUID()}`;
  const input = agentOperation
    ? { targetId: target, mode: subcommand }
    : {
        operation: subcommand,
        ...(target === undefined ? {} : { targetId: target }),
      };
  return [
    "temporal",
    "--namespace",
    "prod",
    "workflow",
    "execute",
    "--workflow-id",
    workflowId,
    "--type",
    agentOperation ? "runStormPromotion" : "manageStormPromotion",
    "--task-queue",
    "monorepo-workflows",
    "--id-conflict-policy",
    "Fail",
    "--execution-timeout",
    agentOperation ? "6h" : "5m",
    "--input",
    JSON.stringify(input),
    ...(json ? ["--output", "json"] : []),
  ];
}

type PromotionCommandRuntime = {
  write: (text: string) => void;
  run: (args: string[]) => Promise<number>;
};

const commandRuntime: PromotionCommandRuntime = {
  write: (text) => {
    console.log(text);
  },
  run: async (args) => {
    const child = Bun.spawn(args, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await child.exited;
  },
};

export async function handlePromotionCommand(
  subcommand: string | undefined,
  args: string[],
  runtime: PromotionCommandRuntime = commandRuntime,
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    runtime.write(USAGE);
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (positionals.length > 1) throw new Error(USAGE);
  const invocation = promotionInvocation(
    subcommand,
    positionals[0],
    values.json,
  );
  if (values["dry-run"]) {
    runtime.write(
      JSON.stringify({ command: "toolkit", arguments: invocation }, null, 2),
    );
    return;
  }
  // The established wrapper resolves Temporal credentials; no S3, browser or
  // solver credential is needed on the operator's workstation.
  const exitCode = await runtime.run(["toolkit", ...invocation]);
  if (exitCode !== 0)
    throw new Error(`Promotion command failed (${String(exitCode)})`);
}
