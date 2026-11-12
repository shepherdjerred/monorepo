import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  PromotionAiAllocationRequestSchema,
  type PromotionAiAllocationRequest,
} from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";

export function promotionAiAllocationInvocation(
  input: PromotionAiAllocationRequest,
  json: boolean,
): string[] {
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return [
    "toolkit",
    "temporal",
    "--namespace",
    "prod",
    "workflow",
    "execute",
    "--workflow-id",
    `storm-promotion/ai-allocation/${digest}`,
    "--type",
    "allocateStormPromotionAi",
    "--task-queue",
    "monorepo-workflows",
    "--id-conflict-policy",
    "Fail",
    "--execution-timeout",
    "5m",
    "--input-file",
    "/dev/stdin",
    ...(json ? ["--output", "json"] : []),
  ];
}

type Runtime = {
  write: (text: string) => void;
  run: (args: string[], input: string) => Promise<number>;
};

const defaultRuntime: Runtime = {
  write: (text) => {
    console.log(text);
  },
  run: async (command, input) =>
    await Bun.spawn(command, {
      stdin: new Blob([input]),
      stdout: "inherit",
      stderr: "inherit",
    }).exited,
};

/** Plan by default. The Activity computes the allocation from reviewed provider counts. */
export async function handlePromotionAiAllocationCommand(
  args: string[],
  runtime: Runtime = defaultRuntime,
): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      file: { type: "string" },
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (values.file === undefined)
    throw new Error(
      "allocate-ai requires --file with reviewed provider evidence",
    );
  if (values.apply && values["dry-run"])
    throw new Error("Choose --apply or --dry-run");
  const file = Bun.file(values.file);
  if (file.size > 256 * 1024)
    throw new Error("Reviewed AI allocation file exceeds 256 KiB");
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new Error("Expected a reviewed AI allocation JSON file");
  }
  const parsed = PromotionAiAllocationRequestSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "Invalid reviewed AI allocation evidence; no Workflow started",
    );
  const input = {
    ...parsed.data,
    operation: values.apply ? ("apply" as const) : ("plan" as const),
  };
  if (!PromotionAiAllocationRequestSchema.safeParse(input).success)
    throw new Error(
      "Apply requires the ledger version, row digest and audit identity returned by native plan",
    );
  const invocation = promotionAiAllocationInvocation(input, values.json);
  if (values["dry-run"]) {
    runtime.write(
      JSON.stringify(
        {
          mode: "dry-run",
          exactUsage: "unknown",
          amountComputedByWorker: true,
          requiresCoverageReview: true,
          invocation,
        },
        null,
        2,
      ),
    );
    return;
  }
  const code = await runtime.run(invocation, JSON.stringify(input));
  if (code !== 0)
    throw new Error(
      `AI allocation Workflow command failed (exit ${String(code)})`,
    );
}
