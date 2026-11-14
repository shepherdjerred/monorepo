import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  PromotionAbsenceEvidenceSchema,
  PromotionAbsenceResolutionSchema,
} from "@shepherdjerred/ops-model/promotion/absence-resolution.ts";

type Runtime = {
  read: (path: string) => Promise<string>;
  run: (args: string[], input: string) => Promise<number>;
  write: (text: string) => void;
};
const native: Runtime = {
  read: async (path) => {
    const file = Bun.file(path);
    if (file.size > 16_384) throw new Error("Absence evidence exceeds 16 KiB");
    return await file.text();
  },
  run: async (args, input) =>
    await Bun.spawn(args, {
      stdin: new Blob([input]),
      stdout: "inherit",
      stderr: "inherit",
    }).exited,
  write: console.log,
};

/** The authenticated wrapper receives only a descriptor path in argv, never evidence. */
export async function handlePromotionAbsence(
  args: string[],
  runtime: Runtime = native,
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "evidence-file": { type: "string" },
      "evidence-sha256": { type: "string" },
      "resolution-id": { type: "string" },
      "expected-state-etag": { type: "string" },
      apply: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1 || values["evidence-file"] === undefined)
    throw new Error(
      "resolve-absence requires one exact target and --evidence-file",
    );
  const evidenceJson = await runtime.read(values["evidence-file"]);
  const digest = createHash("sha256").update(evidenceJson).digest("hex");
  if (digest !== values["evidence-sha256"])
    throw new Error("Absence evidence digest mismatch");
  let raw: unknown;
  try {
    raw = JSON.parse(evidenceJson);
  } catch {
    throw new Error("Invalid absence evidence JSON");
  }
  const evidence = PromotionAbsenceEvidenceSchema.safeParse(raw);
  if (!evidence.success) throw new Error("Invalid absence evidence schema");
  const request = PromotionAbsenceResolutionSchema.safeParse({
    operation: "resolve-absence",
    namespace: "prod",
    targetId: positionals[0],
    resolutionId: values["resolution-id"],
    expectedStateEtag: values["expected-state-etag"],
    evidenceSha256: digest,
    evidenceJson,
    apply: values.apply,
  });
  if (!request.success || request.data.targetId !== evidence.data.targetId)
    throw new Error("Invalid absence resolution identity or reviewed ETag");
  const invocation = [
    "toolkit",
    "temporal",
    "--namespace",
    "prod",
    "workflow",
    "execute",
    "--workflow-id",
    `storm-promotion/absence-resolution/${request.data.resolutionId}/${crypto.randomUUID()}`,
    "--type",
    "resolveStormPromotionAbsence",
    "--task-queue",
    "monorepo-workflows",
    "--id-conflict-policy",
    "Fail",
    "--execution-timeout",
    "5m",
    "--input-file",
    "/dev/stdin",
    ...(values.json ? ["--output", "json"] : []),
  ];
  if (values["dry-run"]) {
    runtime.write(
      JSON.stringify(
        {
          arguments: invocation,
          targetId: request.data.targetId,
          resolutionId: request.data.resolutionId,
          evidenceSha256: digest,
          operation: values.apply ? "apply" : "plan",
        },
        null,
        2,
      ),
    );
    return;
  }
  const code = await runtime.run(invocation, JSON.stringify(request.data));
  if (code !== 0)
    throw new Error(
      `Absence resolution command failed (${String(code)}); inspect readback before another apply`,
    );
}
