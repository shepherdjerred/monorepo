import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import curriculum from "./curriculum.json";
import { PilotLedger } from "./pilot-ledger.ts";
import { runPaperWorker } from "./owner.ts";
import { frozenManifest, frozenTrainingMaps } from "./sandbox.ts";
import { MapBinding } from "./maps/plan.ts";
import { isDeepStrictEqual } from "node:util";

const args = parseArgs({
  options: {
    output: { type: "string" },
    dataset: { type: "string" },
    device: { type: "string" },
    seeds: { type: "string" },
    diagnostic: { type: "boolean", default: false },
    resume: { type: "boolean", default: false },
  },
  strict: true,
});
const output = path.resolve(z.string().min(1).parse(args.values.output));
const sha = (text: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");
async function inputs(dataset: string | null) {
  const files =
    dataset === null
      ? []
      : await Promise.all(
          [
            "manifest.json",
            "train.jsonl",
            "validation.jsonl",
            "test.jsonl",
          ].map(async (file) => ({
            file,
            sha256: sha(
              new Uint8Array(
                await Bun.file(path.join(dataset, file)).arrayBuffer(),
              ),
            ),
          })),
        );
  return {
    native: await frozenManifest(),
    maps: await frozenTrainingMaps(dataset === null),
    dataset: files,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
  };
}

let ledger: PilotLedger;
if (args.values.resume) {
  if (
    args.values.dataset !== undefined ||
    args.values.device !== undefined ||
    args.values.seeds !== undefined ||
    args.values.diagnostic
  )
    throw new Error(
      "resume uses the recorded pilot inputs; provide only output and resume",
    );
  ledger = await PilotLedger.read(output);
  const storedInputs = await Bun.file(path.join(output, "inputs.json")).text();
  if (sha(storedInputs) !== ledger.config.inputSha256)
    throw new Error("stored pilot inputs were altered");
} else {
  const diagnostic = args.values.diagnostic;
  if (diagnostic && args.values.dataset !== undefined)
    throw new Error("diagnostic cannot use human demonstrations");
  const dataset = diagnostic
    ? null
    : path.resolve(z.string().min(1).parse(args.values.dataset));
  const seeds = (args.values.seeds ?? "17000,17001,17002")
    .split(",")
    .map((seed) => z.coerce.number().int().parse(seed));
  const frozen = JSON.stringify(await inputs(dataset), null, 2) + "\n";
  ledger = await PilotLedger.create(output, {
    version: 1,
    acceptance: "unaccepted",
    mode: diagnostic ? "diagnostic" : "pilot",
    seeds,
    seconds: diagnostic ? 300 : 28_800,
    device: z.enum(["cpu", "mps"]).parse(args.values.device ?? "mps"),
    dataset,
    inputSha256: sha(frozen),
  });
  await Bun.write(path.join(output, "inputs.json"), frozen);
}

const config = ledger.config;
async function verifyInputs() {
  const current = JSON.stringify(await inputs(config.dataset), null, 2) + "\n";
  if (sha(current) !== config.inputSha256)
    throw new Error("pilot sources, runtime or dataset changed after freezing");
}
async function verifyFrozen(
  index: number,
  weightsSha256: string,
  manifestSha256: string,
) {
  const checkpoint = path.join(
    output,
    `seed-${index.toString()}/learning/final`,
  );
  const weights = sha(
    new Uint8Array(
      await Bun.file(path.join(checkpoint, "weights.pt")).arrayBuffer(),
    ),
  );
  const manifest = sha(
    await Bun.file(path.join(checkpoint, "manifest.json")).text(),
  );
  if (weights !== weightsSha256 || manifest !== manifestSha256)
    throw new Error("frozen pilot actor was altered");
}
const TrainingSchema = z.object({
  seed: z.number().int(),
  dataset_sha256: z.string(),
  pilot_acceptance_checked: z.literal(false),
  test_used_for_selection: z.literal(false),
  maps: z.array(MapBinding).min(1),
  map_coverage_complete: z.literal(true),
  curriculum: z
    .object({
      stages: z.array(z.string()),
      updates: z.array(z.number().int().nonnegative()),
      complete: z.literal(true),
    })
    .strict(),
});
const CheckpointSchema = z.object({
  kind: z.literal("rwf-trooper-ppo"),
  acceptance: z.literal("unaccepted"),
  weights_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  training: TrainingSchema,
});

for (let index = 0; index < 3; index++) {
  const state = await ledger.state(index);
  if (state.status === "frozen") {
    await verifyFrozen(index, state.weightsSha256, state.manifestSha256);
    continue;
  }
  if (state.status !== "pending")
    throw new Error(
      "pilot has a running, interrupted or failed seed; stop for repair without renewing its budget",
    );
  await verifyInputs();
  const claim = await ledger.claim(index, Date.now());
  try {
    const seedOutput = path.join(output, `seed-${index.toString()}`);
    const { completedMs } = await runPaperWorker({
      ...(config.dataset === null ? {} : { dataset: config.dataset }),
      output: seedOutput,
      device: config.device,
      seed: claim.seed,
      seconds: config.seconds,
      deadlineMs: claim.deadlineMs,
      updates: config.mode === "diagnostic" ? 7 : 100_000,
      episodes: config.mode === "diagnostic" ? 2 : 4,
      opponent: "stationary",
      diagnostic: config.mode === "diagnostic",
      curriculum: true,
    });
    await verifyInputs();
    const checkpoint = path.join(seedOutput, "learning/final");
    const manifestText = await Bun.file(
      path.join(checkpoint, "manifest.json"),
    ).text();
    const rawManifest: unknown = JSON.parse(manifestText);
    const manifest = CheckpointSchema.parse(rawManifest);
    const updates = manifest.training.curriculum.updates;
    const maps = await frozenTrainingMaps(config.mode === "diagnostic");
    if (!isDeepStrictEqual(manifest.training.maps, maps.maps))
      throw new Error("Pilot did not train on the frozen admitted map catalog");
    if (
      manifest.training.seed !== claim.seed ||
      updates.length !== curriculum.stages.length ||
      curriculum.stages.some(
        (stage, phase) =>
          (updates[phase] ?? -1) < stage.minUpdates ||
          manifest.training.curriculum.stages[phase] !== stage.name,
      )
    )
      throw new Error("seed did not complete the fixed curriculum");
    if (
      config.dataset === null
        ? manifest.training.dataset_sha256 !== "synthetic-diagnostic"
        : manifest.training.dataset_sha256 !==
          sha(
            new Uint8Array(
              await Bun.file(
                path.join(config.dataset, "manifest.json"),
              ).arrayBuffer(),
            ),
          )
    )
      throw new Error("frozen actor used different demonstrations");
    const weightsSha256 = sha(
      new Uint8Array(
        await Bun.file(path.join(checkpoint, "weights.pt")).arrayBuffer(),
      ),
    );
    if (manifest.weights_sha256 !== weightsSha256)
      throw new Error("final actor checkpoint hash mismatch");
    await ledger.finish(index, {
      status: "frozen",
      completedMs,
      weightsSha256,
      manifestSha256: sha(manifestText),
    });
  } catch (error) {
    await ledger.finish(index, {
      status: "failed",
      completedMs: Date.now(),
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
console.warn(
  JSON.stringify({
    kind: "pilot-frozen",
    output,
    mode: config.mode,
    seeds: await Promise.all([0, 1, 2].map((index) => ledger.state(index))),
    acceptance: "unaccepted",
    pilotAcceptanceChecked: false,
  }),
);
