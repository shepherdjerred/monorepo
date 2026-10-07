import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import contract from "./evaluation.json";
import { strengthResult } from "./evaluation-gate.ts";
import { PilotLedger } from "./pilot-ledger.ts";
import { runPaperWorker } from "./owner.ts";
import { frozenManifest } from "./sandbox.ts";

const args = parseArgs({
  options: {
    pilot: { type: "string" },
    checkpoint: { type: "string" },
    output: { type: "string" },
    device: { type: "string", default: "cpu" },
    diagnostic: { type: "boolean", default: false },
    matches: { type: "string" },
  },
  strict: true,
});
const diagnostic = args.values.diagnostic;
if (
  diagnostic
    ? args.values.pilot !== undefined
    : args.values.checkpoint !== undefined || args.values.matches !== undefined
)
  throw new Error(
    "pilot evaluation uses all three sealed seeds; checkpoint/matches are diagnostic only",
  );
const output = path.resolve(z.string().min(1).parse(args.values.output));
const device = z.enum(["cpu", "mps"]).parse(args.values.device);
const matches = diagnostic
  ? z.coerce
      .number()
      .int()
      .min(2)
      .max(4)
      .refine((n) => n % 2 === 0)
      .parse(args.values.matches ?? "2")
  : contract.matchesPerOpponent;
const sha = (data: string | Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");
async function checkpointHashes(checkpoint: string) {
  return {
    manifestSha256: sha(
      await Bun.file(path.join(checkpoint, "manifest.json")).text(),
    ),
    weightsSha256: sha(
      new Uint8Array(
        await Bun.file(path.join(checkpoint, "weights.pt")).arrayBuffer(),
      ),
    ),
  };
}
const Checkpoint = z.object({
  kind: z.literal("rwf-trooper-ppo"),
  acceptance: z.literal("unaccepted"),
  weights_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  training: z.object({ seed: z.number().int().min(0).max(1_000_000_000) }),
});
type FrozenActor = {
  checkpoint: string;
  seed: number;
  weightsSha256: string;
  manifestSha256: string;
};
const actors: FrozenActor[] = [];
const native = await frozenManifest();
let pilot: PilotLedger | undefined;
let datasetFiles: { file: string; sha256: string }[] = [];
if (diagnostic) {
  const checkpoint = path.resolve(
    z.string().min(1).parse(args.values.checkpoint),
  );
  const raw: unknown = await Bun.file(
    path.join(checkpoint, "manifest.json"),
  ).json();
  const manifest = Checkpoint.parse(raw);
  const hashes = await checkpointHashes(checkpoint);
  if (manifest.weights_sha256 !== hashes.weightsSha256)
    throw new Error("diagnostic checkpoint weights hash differs");
  actors.push({ checkpoint, seed: manifest.training.seed, ...hashes });
} else {
  pilot = await PilotLedger.read(
    path.resolve(z.string().min(1).parse(args.values.pilot)),
  );
  if (pilot.config.mode !== "pilot")
    throw new Error("diagnostic pilots cannot establish acceptance");
  const inputText = await Bun.file(
    path.join(pilot.output, "inputs.json"),
  ).text();
  if (sha(inputText) !== pilot.config.inputSha256)
    throw new Error("pilot inputs were altered");
  const Inputs = z.object({
    native: z.object({
      hashes: z.array(
        z.object({ file: z.string(), sha256: z.string() }).strict(),
      ),
      engine: z.literal("Paper"),
      controllerHz: z.literal(20),
      timeoutTicks: z.literal(1200),
      runtime: z.unknown(),
    }),
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
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .length(4)
      .refine((files) => new Set(files.map((file) => file.file)).size === 4),
  });
  const rawInputs: unknown = JSON.parse(inputText);
  const frozen = Inputs.parse(rawInputs);
  datasetFiles = frozen.dataset;
  // Training tooling can evolve, but the frozen authored opponent, content,
  // observation contract and native runtime must be the same for this gate.
  const runtimeInputs = (hashes: typeof native.hashes) =>
    hashes.filter((entry) => !entry.file.startsWith("tools/learning/"));
  if (
    JSON.stringify(runtimeInputs(frozen.native.hashes)) !==
      JSON.stringify(runtimeInputs(native.hashes)) ||
    JSON.stringify(frozen.native.runtime) !== JSON.stringify(native.runtime)
  )
    throw new Error(
      "evaluation runtime differs from the pilot's frozen opponent",
    );
  for (const file of frozen.dataset) {
    const dataset = z.string().parse(pilot.config.dataset);
    if (
      sha(
        new Uint8Array(
          await Bun.file(path.join(dataset, file.file)).arrayBuffer(),
        ),
      ) !== file.sha256
    )
      throw new Error("pilot demonstrations changed after freezing");
  }
  for (let index = 0; index < 3; index++) {
    const state = await pilot.state(index);
    if (state.status !== "frozen")
      throw new Error(
        "all three pilot actors must be frozen before evaluation",
      );
    const checkpoint = path.join(
      pilot.output,
      `seed-${index.toString()}/learning/final`,
    );
    const hashes = await checkpointHashes(checkpoint);
    if (
      hashes.weightsSha256 !== state.weightsSha256 ||
      hashes.manifestSha256 !== state.manifestSha256
    )
      throw new Error("sealed pilot actor was altered");
    actors.push({ checkpoint, seed: state.claim.seed, ...hashes });
  }
}
const frozenText = JSON.stringify(native);
async function verifyInputs() {
  if (JSON.stringify(await frozenManifest()) !== frozenText)
    throw new Error("evaluation runtime or tooling changed after freezing");
  for (const actor of actors) {
    const hashes = await checkpointHashes(actor.checkpoint);
    if (
      hashes.weightsSha256 !== actor.weightsSha256 ||
      hashes.manifestSha256 !== actor.manifestSha256
    )
      throw new Error("frozen evaluation actor was altered");
  }
  if (pilot !== undefined) {
    const text = await Bun.file(path.join(pilot.output, "inputs.json")).text();
    if (sha(text) !== pilot.config.inputSha256)
      throw new Error("pilot inputs changed during evaluation");
    for (const file of datasetFiles) {
      const dataset = z.string().parse(pilot.config.dataset);
      if (
        sha(
          new Uint8Array(
            await Bun.file(path.join(dataset, file.file)).arrayBuffer(),
          ),
        ) !== file.sha256
      )
        throw new Error("pilot demonstrations changed during evaluation");
    }
  }
}
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const plan = {
  version: 1,
  mode: diagnostic ? "diagnostic" : "pilot",
  acceptance: "unaccepted",
  native,
  actors,
  matchesPerOpponent: matches,
  firstSeed: contract.firstSeed,
  device,
  retries: 0,
  optimized: false,
  pilotAcceptanceChecked: false,
};
if (pilot !== undefined) {
  // An interrupted/failed evaluation cannot silently choose a fresh run.
  const claim = await open(
    path.join(pilot.output, "strength-evaluation.claimed.json"),
    "wx",
    0o600,
  );
  try {
    await claim.writeFile(
      JSON.stringify({ output, planSha256: sha(JSON.stringify(plan)) }),
    );
    await claim.sync();
  } finally {
    await claim.close();
  }
  const directory = await open(pilot.output, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
await Bun.write(
  path.join(output, "evaluation-plan.json"),
  JSON.stringify(plan, null, 2) + "\n",
);
const results = [];
for (const [index, actor] of actors.entries()) {
  await verifyInputs();
  const seconds = diagnostic ? 300 : 28_800;
  const seedOutput = path.join(output, `seed-${index.toString()}`);
  await runPaperWorker({
    checkpoint: actor.checkpoint,
    output: seedOutput,
    device,
    seed: actor.seed,
    seconds,
    deadlineMs: Date.now() + seconds * 1000,
    diagnostic,
    evaluation: { matches, firstSeed: contract.firstSeed },
  });
  await verifyInputs();
  const raw: unknown = await Bun.file(
    path.join(seedOutput, "learning/report.json"),
  ).json();
  const result = strengthResult(raw, matches, contract.firstSeed);
  if (
    result.report.actor_seed !== actor.seed ||
    result.report.weights_sha256 !== actor.weightsSha256 ||
    result.report.manifest_sha256 !== actor.manifestSha256 ||
    result.report.mode !== plan.mode
  )
    throw new Error("evaluation report differs from the frozen actor");
  results.push({
    seed: actor.seed,
    passed: result.passed,
    opponents: result.opponents,
  });
}
const strengthPassed =
  !diagnostic &&
  results.length === 3 &&
  results.every((result) => result.passed);
const report = {
  version: 1,
  mode: plan.mode,
  acceptance: "unaccepted",
  strengthPassed,
  blindPreferenceChecked: false,
  pilotAcceptanceChecked: false,
  learnedControlEnabled: false,
  results,
};
await Bun.write(
  path.join(output, "strength-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.warn(
  JSON.stringify({ kind: "frozen-strength-result", output, ...report }),
);
if (!diagnostic && !strengthPassed) process.exitCode = 1;
