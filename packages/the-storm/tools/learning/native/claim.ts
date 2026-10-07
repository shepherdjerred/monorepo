import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Digest, preferenceSchedule } from "#learning/preference/gate.ts";
import { jsonText, seal, sha } from "#learning/preference/ledger.ts";
import type { reviewEligibility } from "#learning/preference/eligibility.ts";

const FileDigest = z.strictObject({ file: z.string().min(1), sha256: Digest });
const Inputs = z.strictObject({
  native: z.unknown(),
  renderer: z.array(FileDigest).min(1),
  artifacts: z.strictObject({ actor: Digest, manifest: Digest }),
});

export const CapturePlan = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-native-preference-capture"),
  acceptance: z.literal("unaccepted"),
  diagnostic: z.literal(false),
  retries: z.literal(0),
  pilot: z.string().min(1),
  evaluation: z.string().min(1),
  model: z.string().min(1),
  output: z.string().min(1),
  eligibility: z.strictObject({
    actor_sha256: Digest,
    native_sha256: Digest,
    files: z
      .array(z.strictObject({ file: z.string().min(1), sha256: Digest }))
      .min(1),
  }),
  inputs: Inputs,
  schedule: z
    .array(
      z.strictObject({
        pair: z.number().int().min(1).max(20),
        seed: z.number().int(),
        side: z.enum(["red", "blue"]),
      }),
    )
    .length(20),
});
export const CaptureClaim = z.strictObject({
  schema: z.literal(1),
  output: z.string().min(1),
  plan_sha256: Digest,
});
export const captureClaimFile = (pilot: string) =>
  path.join(pilot, "native-preference-capture.claimed.json");

/** Durable and exclusive. The caller must establish genuine eligibility before calling. */
export async function claimCapture(options: {
  pilot: string;
  evaluation: string;
  model: string;
  output: string;
  eligibility: Awaited<ReturnType<typeof reviewEligibility>>;
  inputs: z.input<typeof Inputs>;
}) {
  const plan = CapturePlan.parse({
    schema: 1,
    kind: "rwf-native-preference-capture",
    acceptance: "unaccepted",
    diagnostic: false,
    retries: 0,
    ...options,
    schedule: preferenceSchedule(),
  });
  await mkdir(path.dirname(options.output), { recursive: true });
  await mkdir(options.output, { recursive: false, mode: 0o700 });
  const bytes = jsonText(plan);
  await seal(path.join(options.output, "plan.json"), bytes);
  const claim = CaptureClaim.parse({
    schema: 1,
    output: options.output,
    plan_sha256: sha(bytes),
  });
  await seal(captureClaimFile(options.pilot), jsonText(claim));
  return { plan, claim };
}
