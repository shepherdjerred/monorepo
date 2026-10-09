import { z } from "zod";
import type {
  WoodpeckerConfig,
  WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";
import { boundedLogs } from "./native-logs.ts";
import { reviewEvidence, type ReviewEvidence } from "./review-evidence.ts";

const SecondsSchema = z.number().int().nonnegative();
const CheckoutSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string().regex(/^[a-f\d]{40}$/),
  cache: z.enum(["hit", "miss"]),
  downloadedObjectBytes: SecondsSchema,
  downloadMs: SecondsSchema,
  materializationMs: SecondsSchema,
  totalMs: SecondsSchema,
});
const BootstrapSchema = z.object({
  schemaVersion: z.literal(1),
  sourceSha: z.string().regex(/^[a-f\d]{40}$/),
  scope: z.enum([
    "preflight",
    "runtime",
    "tofu",
    "automation",
    "deployment",
    "postgres",
    "full",
  ]),
  elapsedSeconds: SecondsSchema,
});

type StepEvidence = {
  workflow: string;
  step: string;
  stepId: number;
  available: boolean;
  checkout: z.infer<typeof CheckoutSchema> | null;
  bootstrap: z.infer<typeof BootstrapSchema>[];
};
export type LatencyEvidence = {
  review: ReviewEvidence;
  steps: StepEvidence[];
};

function diagnostic<T>(
  line: string,
  prefix: string,
  schema: z.ZodType<T>,
): T | null {
  return line.startsWith(prefix)
    ? schema.parse(JSON.parse(line.slice(prefix.length)))
    : null;
}

/** Keep only typed measurements, never raw command output or exception text. */
export function stepEvidence(
  lines: readonly string[],
  pipeline: WoodpeckerPipeline,
) {
  let checkout: z.infer<typeof CheckoutSchema> | null = null;
  const bootstrap: z.infer<typeof BootstrapSchema>[] = [];
  for (const line of lines) {
    const source = diagnostic(line, "CI_CHECKOUT_DIAGNOSTIC ", CheckoutSchema);
    const toolchain = diagnostic(
      line,
      "CI_BOOTSTRAP_DIAGNOSTIC ",
      BootstrapSchema,
    );
    if (source !== null) {
      if (checkout !== null || source.sourceSha !== pipeline.commit)
        throw new Error("Checkout evidence identity or uniqueness mismatch");
      checkout = source;
    }
    if (toolchain !== null) {
      if (toolchain.sourceSha !== pipeline.commit)
        throw new Error("Bootstrap evidence identity mismatch");
      bootstrap.push(toolchain);
    }
  }
  return { checkout, bootstrap };
}

function selectedSteps(pipeline: WoodpeckerPipeline) {
  return pipeline.workflows.flatMap((workflow) =>
    (workflow.children ?? [])
      .filter(
        (step) =>
          step.state === "success" &&
          step.type !== "service" &&
          (step.name === "clone" ||
            (step.name === workflow.name &&
              (workflow.name.includes("review") ||
                ["verify", "draft-preflight", "release-please"].includes(
                  workflow.name,
                ) ||
                workflow.name.startsWith("maintenance-")))),
      )
      .map((step) => ({ pipeline, workflow: workflow.name, step })),
  );
}

function retainedReviewEvidence(
  lines: readonly string[],
  pipeline: WoodpeckerPipeline,
): ReviewEvidence {
  try {
    return reviewEvidence(lines, pipeline);
  } catch {
    // Invalid review evidence does not invalidate typed measurements.
    return { kind: "unknown", providers: [] };
  }
}

/** Four log reads at a time, independent of history size. */
export async function latencyEvidence(
  pipelines: readonly WoodpeckerPipeline[],
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<Map<number, LatencyEvidence>> {
  const records = new Map<number, LatencyEvidence>(
    pipelines.map((pipeline) => [
      pipeline.number,
      {
        review: { kind: "unknown", providers: [] },
        steps: [],
      },
    ]),
  );
  const pending = pipelines.flatMap((pipeline) => selectedSteps(pipeline));
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
        const record = records.get(item.pipeline.number);
        if (record === undefined)
          throw new Error("Missing pipeline evidence record");
        const evidence: StepEvidence = {
          workflow: item.workflow,
          step: item.step.name,
          stepId: item.step.id,
          available: false,
          checkout: null,
          bootstrap: [],
        };
        let lines: string[];
        try {
          lines = await boundedLogs(
            `/api/repos/${String(config.repoId)}/logs/${String(item.pipeline.number)}/${String(item.step.id)}`,
            config,
            signal,
          );
        } catch (error) {
          if (signal?.aborted === true) throw error;
          // Missing/oversized retained logs cannot become zero timings.
          record.steps.push(evidence);
          continue;
        }
        try {
          Object.assign(evidence, stepEvidence(lines, item.pipeline), {
            available: true,
          });
        } catch {
          // Invalid measurements do not invalidate independent review evidence.
        }
        if (
          item.workflow.includes("review") &&
          item.step.name === item.workflow
        ) {
          record.review = retainedReviewEvidence(lines, item.pipeline);
        }
        record.steps.push(evidence);
      }
    }),
  );
  for (const record of records.values())
    record.steps.sort((a, b) => a.stepId - b.stepId);
  return records;
}
