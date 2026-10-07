import path from "node:path";
import { z } from "zod";
import { strengthResult } from "#learning/evaluation-gate.ts";
import evaluation from "#learning/evaluation.json";
import { PilotLedger } from "#learning/pilot-ledger.ts";
import { Digest, preferenceSchedule } from "./gate.ts";
import { digestFile, readJson, sha } from "./ledger.ts";
import { run } from "./media.ts";
import { root } from "#learning/sandbox.ts";

const Native = z
  .object({
    hashes: z.array(z.object({ file: z.string(), sha256: Digest }).strict()),
    engine: z.literal("Paper"),
    controllerHz: z.literal(20),
    timeoutTicks: z.literal(1200),
    runtime: z.unknown(),
  })
  .strict();
const Inputs = z
  .object({
    native: Native,
    dataset: z
      .array(
        z
          .object({
            file: z.enum([
              "manifest.json",
              "train.jsonl",
              "validation.jsonl",
              "test.jsonl",
            ]),
            sha256: Digest,
          })
          .strict(),
      )
      .length(4),
    bunVersion: z.string(),
    platform: z.string(),
    arch: z.string(),
  })
  .strict();
const Training = z.object({
  seed: z.number().int(),
  dataset_sha256: Digest,
  provenance: z.literal("human-bc-plus-paper-ppo"),
  test_used_for_selection: z.literal(false),
  pilot_acceptance_checked: z.literal(false),
  curriculum: z.object({ complete: z.literal(true) }),
  games: z.array(z.object({ seed: z.number().int() })),
});
const Checkpoint = z.object({
  kind: z.literal("rwf-trooper-ppo"),
  acceptance: z.literal("unaccepted"),
  weights_sha256: Digest,
  training: Training,
});
const EvaluationActor = z
  .object({
    checkpoint: z.string(),
    seed: z.number().int(),
    weightsSha256: Digest,
    manifestSha256: Digest,
  })
  .strict();
type Snapshot = (file: string, expected?: string) => Promise<string>;
type Frozen = Extract<
  Awaited<ReturnType<PilotLedger["state"]>>,
  { status: "frozen" }
>;

async function validateStrengthActor(
  index: number,
  declared: z.infer<typeof EvaluationActor> | undefined,
  context: {
    pilot: PilotLedger;
    evaluationPath: string;
    datasetSha: string;
    snapshot: Snapshot;
    matches: Set<string>;
  },
) {
  const { pilot, evaluationPath, datasetSha, snapshot, matches } = context;
  const state = await pilot.state(index);
  if (state.status !== "frozen")
    throw new Error("all pilot seeds must be sealed before review");
  const checkpoint = path.join(
    pilot.output,
    `seed-${index.toString()}/learning/final`,
  );
  await snapshot(
    path.join(pilot.output, `seed-${index.toString()}.claimed.json`),
  );
  await snapshot(
    path.join(pilot.output, `seed-${index.toString()}.result.json`),
  );
  await snapshot(path.join(checkpoint, "manifest.json"), state.manifestSha256);
  await snapshot(path.join(checkpoint, "weights.pt"), state.weightsSha256);
  const actor = Checkpoint.parse(
    await readJson(path.join(checkpoint, "manifest.json")),
  );
  if (
    actor.training.seed !== state.claim.seed ||
    actor.training.dataset_sha256 !== datasetSha ||
    actor.weights_sha256 !== state.weightsSha256 ||
    declared?.checkpoint !== checkpoint ||
    declared.seed !== state.claim.seed ||
    declared.weightsSha256 !== state.weightsSha256 ||
    declared.manifestSha256 !== state.manifestSha256 ||
    actor.training.games.some((game) =>
      preferenceSchedule().some((match) => match.seed === game.seed),
    )
  )
    throw new Error(
      "review actor differs from sealed training, or review seeds overlap training",
    );
  const reportFile = path.join(
    evaluationPath,
    `seed-${index.toString()}/learning/report.json`,
  );
  await snapshot(reportFile);
  const strength = strengthResult(
    await readJson(reportFile),
    200,
    evaluation.firstSeed,
  );
  if (
    !strength.passed ||
    strength.report.actor_seed !== state.claim.seed ||
    strength.report.weights_sha256 !== state.weightsSha256 ||
    strength.report.manifest_sha256 !== state.manifestSha256
  )
    throw new Error(
      "blind review requires every sealed actor to pass both frozen strength gates",
    );
  for (const game of strength.report.games) {
    if (matches.has(game.match))
      throw new Error(
        "strength reports reuse a native match across pilot seeds",
      );
    matches.add(game.match);
  }
  return state;
}

async function validateCandidate(
  first: Frozen,
  model: string,
  datasetSha: string,
  snapshot: Snapshot,
) {
  const manifestFile = path.join(model, "manifest.json");
  await snapshot(manifestFile);
  const exported = z
    .object({
      schema: z.literal(1),
      kind: z.literal("rwf-trooper-ppo"),
      acceptance: z.literal("unaccepted"),
      weights_sha256: Digest,
      onnx_sha256: Digest,
      checkpoint_manifest_sha256: Digest,
      training: Training,
    })
    .parse(await readJson(manifestFile));
  if (
    exported.weights_sha256 !== first.weightsSha256 ||
    exported.checkpoint_manifest_sha256 !== first.manifestSha256 ||
    exported.training.seed !== first.claim.seed ||
    exported.training.dataset_sha256 !== datasetSha
  )
    throw new Error(
      "review must use the first sealed pilot actor; score-based seed selection is forbidden",
    );
  await snapshot(path.join(model, "actor.onnx"), exported.onnx_sha256);
  return exported.onnx_sha256;
}

/** Read the already claimed strength run; never choose a seed using its scores. */
export async function reviewEligibility(
  pilotPath: string,
  evaluationPath: string,
  model: string,
) {
  const pilot = await PilotLedger.read(pilotPath);
  if (pilot.config.mode !== "pilot")
    throw new Error(
      "diagnostic pilots cannot establish human preference acceptance",
    );
  if (pilot.config.dataset === null)
    throw new Error("pilot has no human dataset");
  const files = new Map<string, string>();
  const snapshot = async (file: string, expected?: string) => {
    const digest = await digestFile(file);
    if (expected !== undefined && digest !== expected)
      throw new Error(`frozen pilot evidence changed: ${file}`);
    files.set(file, digest);
    return digest;
  };
  await snapshot(path.join(pilotPath, "pilot.json"));
  await snapshot(path.join(pilotPath, "inputs.json"), pilot.config.inputSha256);
  const inputs = Inputs.parse(
    await readJson(path.join(pilotPath, "inputs.json")),
  );
  if (new Set(inputs.dataset.map((file) => file.file)).size !== 4)
    throw new Error("pilot does not freeze every dataset split");
  for (const file of inputs.dataset)
    await snapshot(path.join(pilot.config.dataset, file.file), file.sha256);
  const rawDataset: unknown = JSON.parse(
    await run([
      "uv",
      "run",
      "--directory",
      path.join(root, "tools/learning"),
      "--locked",
      "python",
      "-m",
      "preference.inputs",
      pilot.config.dataset,
    ]),
  );
  const dataset = z
    .object({ dataset_sha256: Digest })
    .strict()
    .parse(rawDataset);
  const datasetFile = inputs.dataset.find(
    (file) => file.file === "manifest.json",
  );
  if (dataset.dataset_sha256 !== datasetFile?.sha256)
    throw new Error(
      "preference dataset differs from frozen training demonstrations",
    );

  const rawEvaluation = await readJson(
    path.join(evaluationPath, "evaluation-plan.json"),
  );
  const plan = z
    .object({
      version: z.literal(1),
      mode: z.literal("pilot"),
      acceptance: z.literal("unaccepted"),
      native: Native,
      actors: z.array(EvaluationActor).length(3),
      matchesPerOpponent: z.literal(evaluation.matchesPerOpponent),
      firstSeed: z.literal(evaluation.firstSeed),
      device: z.enum(["cpu", "mps"]),
      retries: z.literal(0),
      optimized: z.literal(false),
      pilotAcceptanceChecked: z.literal(false),
    })
    .strict()
    .parse(rawEvaluation);
  const claimFile = path.join(pilotPath, "strength-evaluation.claimed.json");
  const claim = z
    .object({ output: z.string(), planSha256: Digest })
    .strict()
    .parse(await readJson(claimFile));
  if (
    claim.output !== evaluationPath ||
    claim.planSha256 !== sha(JSON.stringify(rawEvaluation))
  )
    throw new Error(
      "review is not using the pilot's original claimed strength run",
    );
  await snapshot(claimFile);
  await snapshot(path.join(evaluationPath, "evaluation-plan.json"));
  const runtimeInputs = (native: z.infer<typeof Native>) => ({
    ...native,
    hashes: native.hashes.filter(
      (file) => !file.file.startsWith("tools/learning/"),
    ),
  });
  if (
    JSON.stringify(runtimeInputs(plan.native)) !==
    JSON.stringify(runtimeInputs(inputs.native))
  )
    throw new Error("review evaluation has a different frozen native opponent");
  for (const file of runtimeInputs(inputs.native).hashes)
    await snapshot(path.join(root, file.file), file.sha256);
  const states: Frozen[] = [];
  const matches = new Set<string>();
  for (let index = 0; index < 3; index++)
    states.push(
      await validateStrengthActor(index, plan.actors[index], {
        pilot,
        evaluationPath,
        datasetSha: dataset.dataset_sha256,
        snapshot,
        matches,
      }),
    );
  const first = states[0];
  if (first === undefined) throw new Error("first pilot actor is not sealed");
  const actorSha = await validateCandidate(
    first,
    model,
    dataset.dataset_sha256,
    snapshot,
  );
  for (const file of [
    "package.json",
    "../../bun.lock",
    "scripts/bots/learning/dataset.py",
    "scripts/bots/learning/preference_recording.py",
    "tools/learning/preference/inputs.py",
    "tools/learning/data.py",
    "tools/learning/policy.py",
    "tools/learning/uv.lock",
    "tools/learning/preference/contract.json",
    "tools/learning/preference/gate.ts",
    "tools/learning/preference/ledger.ts",
    "tools/learning/preference/media.ts",
    "tools/learning/preference/eligibility.ts",
    "tools/learning/preference/index.ts",
  ])
    await snapshot(path.join(root, file));
  return {
    actor_sha256: actorSha,
    native_sha256: sha(JSON.stringify(runtimeInputs(inputs.native))),
    files: Array.from(files, ([file, sha256]) => ({ file, sha256 })),
  };
}
