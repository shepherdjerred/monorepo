import path from "node:path";
import { z } from "zod";
import {
  Native,
  RegressionEvidence,
  contract,
} from "#learning/promotion/contract.ts";
import { Digest } from "#learning/preference/gate.ts";

export const File = z.strictObject({ file: z.string().min(1), sha256: Digest });
export const CaptureInputs = z.strictObject({
  native: Native,
  renderer: z.array(File).min(1),
  artifacts: z.strictObject({ actor: Digest, manifest: Digest }),
});
export const SimulationInputs = z.strictObject({
  classpath_sha256: Digest,
  classpath: z.array(z.string().refine(path.isAbsolute)).min(1),
  hashes: z
    .array(
      z.strictObject({
        file: z.string().refine(path.isAbsolute),
        kind: z.enum(["absent", "directory", "file"]),
        sha256: Digest.nullable(),
      }),
    )
    .min(1),
  sources: z.array(File).min(1),
});
export const Inputs = z.strictObject({
  capture: CaptureInputs,
  simulation: SimulationInputs,
  simulation_classpath: File,
});
export type Inputs = z.infer<typeof Inputs>;
export const Case = z.strictObject({
  name: z.enum(contract.regressionCases),
  directory: z.string().refine(path.isAbsolute),
  receipt_sha256: Digest,
});
export type Case = z.infer<typeof Case>;
export const Suite = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-original-regression-suite"),
  acceptance: z.literal("unaccepted"),
  diagnostic: z.literal(true),
  retries: z.literal(0),
  inputs: Inputs,
  cases: z.array(Case).length(contract.regressionCases.length),
  measured: RegressionEvidence,
  measured_sha256: Digest,
  modelAccepted: z.literal(false),
  humanTrainingPerformed: z.literal(false),
  rolloutEnabled: z.literal(false),
});
export type Suite = z.infer<typeof Suite>;

export const cases = [
  {
    name: "human-combat",
    kind: "rwf-native-human-combat-diagnostic",
    script: "regression/human.ts",
  },
  {
    name: "spectator-immunity",
    kind: "rwf-native-spectator-immunity-diagnostic",
    script: "regression/watcher.ts",
  },
  {
    name: "last-human-abort",
    kind: "rwf-native-last-human-abort-diagnostic",
    script: "regression/abort.ts",
  },
  {
    name: "healing-and-lifecycle",
    kind: "rwf-native-healing-lifecycle-diagnostic",
    script: "regression/healing.ts",
  },
  {
    name: "native-team-advancement",
    kind: "rwf-native-team-advancement-diagnostic",
    script: "regression-diagnostic.ts",
  },
  {
    name: "native-los-and-knockback",
    kind: "rwf-native-los-knockback-diagnostic",
    script: "regression/melee.ts",
  },
  {
    name: "simulation-floors",
    kind: "rwf-authored-simulation-floor-diagnostic",
    script: "simulation/index.ts",
  },
] as const;
if (
  JSON.stringify(cases.map((row) => row.name)) !==
  JSON.stringify(contract.regressionCases)
)
  throw new Error(
    "Original regression collector differs from fixed promotion cases",
  );
