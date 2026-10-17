import { parseArgs } from "node:util";
import { z } from "zod";
import { inspectBenchmark } from "#lib/ci/benchmark-store.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";

export async function ciBenchmarkCommand(args: string[]): Promise<void> {
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      console.log(`toolkit ci benchmark evidence <PIPELINE> --head <SHA> --variant baseline|candidate [--profile NAME] [--archive] [--json]

Inspect a terminal manual verify canary's retained resource report. Source and
variant are mandatory assertions. Uses the standard AWS profile (default:
seaweedfs) for ci-handoff; credentials never enter the evidence. --archive writes
the sanitized result under its SHA256 and verifies its readback.
Exit 0: collection complete, resources healthy and workload passed; 1: recorded
collection/resource/workload failure; 2: usage, identity, or upstream error.
This component report does not qualify physical savings or production rollout.
`);
      return;
    }
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        head: { type: "string" },
        variant: { type: "string" },
        profile: { type: "string", default: "seaweedfs" },
        archive: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
    });
    if (positionals.length !== 2 || positionals[0] !== "evidence")
      throw new Error("Expected ci benchmark evidence <PIPELINE>");
    const number = z.coerce.number().int().positive().parse(positionals[1]);
    const head = z
      .string()
      .regex(/^[a-f\d]{40}$/u)
      .parse(values.head);
    const variant = z.enum(["baseline", "candidate"]).parse(values.variant);
    const profile = z.string().min(1).parse(values.profile);
    const report = await inspectBenchmark(
      number,
      { head, variant, profile, archive: values.archive },
      await loadWoodpeckerConfig(),
    );
    console.log(sanitizeText(JSON.stringify(report, null, 2)));
    process.exitCode =
      report.collectionComplete && report.resourceHealthy && report.taskSuccess
        ? 0
        : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        outcome: "error",
        error: sanitizeText(
          error instanceof Error ? error.message : String(error),
        ),
      }),
    );
    process.exitCode = 2;
  }
}
