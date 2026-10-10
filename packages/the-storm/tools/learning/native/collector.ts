import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { buildCaptureInputs, captureInputs } from "./inputs.ts";
import { claimCapture } from "./claim.ts";
import { capturePair } from "./pairs.ts";
import type { NativeClip } from "./pairs.ts";
import { originalRecordings } from "./recordings.ts";
import { verifyNativeCaptures } from "./verify.ts";
import {
  reviewEligibility,
  nativeFingerprint,
} from "#learning/preference/eligibility.ts";
import {
  preferenceSchedule,
  validateCaptures,
} from "#learning/preference/gate.ts";
import { digestFile, jsonText, seal } from "#learning/preference/ledger.ts";
import { openPaperDuels } from "#learning/sandbox.ts";
import contract from "#learning/preference/contract.json";

const args = parseArgs({
  options: {
    pilot: { type: "string" },
    evaluation: { type: "string" },
    model: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
const required = (value: string | undefined) =>
  path.resolve(z.string().min(1).parse(value));
const pilot = required(args.values.pilot);
const evaluation = required(args.values.evaluation);
const model = required(args.values.model);
const output = required(args.values.output);
await buildCaptureInputs();
const eligibility = await reviewEligibility(pilot, evaluation, model);
const inputs = await captureInputs(model);
if (
  inputs.artifacts.actor !== eligibility.actor_sha256 ||
  nativeFingerprint(inputs.native) !== eligibility.native_sha256
)
  throw new Error(
    "Collector inputs differ from the genuine eligible actor or native runtime",
  );
const { claim } = await claimCapture({
  pilot,
  evaluation,
  model,
  output,
  eligibility,
  inputs,
});
const save = (name: string, value: unknown) =>
  seal(path.join(output, name), jsonText(value));
const clips: NativeClip[] = [];
async function collect() {
  const paper = await openPaperDuels(output, model);
  const pairs = [];
  try {
    await paper.inference.load();
    const observer = await paper.openObserver();
    await paper.duels.command("begin 600090000 red authored basic");
    const warmup = await paper.duels.waitFor(
      (state) => !["waiting", "live"].includes(state.result),
      90_000,
    );
    if (!["win", "loss", "draw", "timeout"].includes(warmup.result))
      throw new Error("Native collector warm-up was interrupted");
    await paper.duels.command("cancel");
    for (const match of preferenceSchedule()) {
      const pair = await capturePair({
        paper,
        observer,
        name: `pair-${match.pair.toString().padStart(2, "0")}`,
        seed: match.seed,
        side: match.side,
        opponent: "authored",
        onClip: async (clip) => {
          clips.push(clip);
          await save(
            `pair-${match.pair.toString().padStart(2, "0")}-${clip.mode}.json`,
            clip,
          );
        },
      });
      pairs.push({ pair: match.pair, ...pair });
    }
    return { pairs, warmup };
  } finally {
    await paper.stop();
  }
}
async function finalize(collection: Awaited<ReturnType<typeof collect>>) {
  const { pairs, warmup } = collection;
  if (JSON.stringify(await captureInputs(model)) !== JSON.stringify(inputs))
    throw new Error(
      "Collector model, native environment or renderer changed during capture",
    );
  const recordings = await originalRecordings(
    output,
    clips.map((clip) => clip.state),
  );
  const first = clips[0];
  if (
    first === undefined ||
    clips.some(
      (clip) => JSON.stringify(clip.camera) !== JSON.stringify(first.camera),
    )
  )
    throw new Error(
      "Collector requires one unchanged camera across all original matches",
    );
  const declaredClip = (clip: NativeClip) => {
    const recording = recordings.find(
      (source) => source.match === clip.state.match,
    );
    if (recording === undefined)
      throw new Error("Collector original recording is missing");
    return {
      video: path.relative(output, clip.video.video),
      recording: path.relative(output, recording.file),
      metrics: clip.metrics,
      state: clip.state,
    };
  };
  const captures = validateCaptures({
    version: 1,
    engine: "Paper",
    acceptance: "unaccepted",
    actor_sha256: eligibility.actor_sha256,
    native_sha256: eligibility.native_sha256,
    retries: 0,
    window: contract.window,
    camera: first.camera,
    pairs: pairs.map((pair) => ({
      pair: pair.pair,
      learned: declaredClip(pair.learned),
      authored: declaredClip(pair.authored),
    })),
  });
  await save("captures.json", captures);
  await save("verification.json", {
    schema: 1,
    kind: "rwf-native-preference-capture",
    acceptance: "unaccepted",
    diagnostic: false,
    retries: 0,
    plan_sha256: claim.plan_sha256,
    captures_sha256: await digestFile(path.join(output, "captures.json")),
    pilotAcceptanceChecked: false,
    humanPreferenceMeasured: false,
    rolloutEnabled: false,
    warmup,
    clips,
    recordings,
  });
  await verifyNativeCaptures(
    pilot,
    eligibility,
    path.join(output, "captures.json"),
  );
}
try {
  await finalize(await collect());
} catch (error) {
  await save("failure.json", {
    schema: 1,
    kind: "rwf-native-preference-capture-failure",
    acceptance: "unaccepted",
    diagnostic: false,
    retries: 0,
    plan_sha256: claim.plan_sha256,
    error: error instanceof Error ? error.message : String(error),
    completedClips: clips,
  });
  throw error;
}
console.warn(
  `Sealed twenty original native pairs for manual blind review: ${output}`,
);
