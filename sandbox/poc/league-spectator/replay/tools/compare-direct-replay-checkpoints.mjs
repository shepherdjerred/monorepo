import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { prepareDirectReplayFromFiles } from "./direct-replay-preparation.mjs";
import { compareCheckpointRuntime } from "./compare-checkpoint-runtime.mjs";

const [reportPath, publicRoot, threeModule, destination, selectionMode] =
  process.argv.slice(2);
if (!destination || !["catalog", "legacy"].includes(selectionMode))
  throw Error(
    "Usage: bun compare-direct-replay-checkpoints.mjs <report.json> <public-root> <three.module.js> <fresh-output-directory> <catalog|legacy>",
  );
const outputDirectory = resolve(destination);
const controlSha256 = new Bun.CryptoHasher("sha256")
  .update(await Bun.file(import.meta.path).bytes())
  .digest("hex");
await mkdir(outputDirectory, { recursive: true });
if (await Bun.file(join(outputDirectory, "result.json")).exists())
  throw Error("Fresh checkpoint comparison output required");
const started = performance.now(),
  stages = [];
const onStage = (row) => {
  const stage = { ...row, elapsedMs: performance.now() - started };
  stages.push(stage);
  const text = JSON.stringify(stage);
  if (text.length > 5000) throw Error("Bounded comparison progress required");
  console.log(text);
};
try {
  onStage({ stage: "prepare" });
  const prepared = await prepareDirectReplayFromFiles({
    publicRoot,
    reportPath,
    threeModule,
    outputDirectory,
    selectionMode,
    checkpointControl: true,
    onPreparation: (event) => onStage({ stage: "preparation", event }),
  });
  if (!prepared.runtimePair)
    throw Error("Preparation-owned checkpoint runtime pair required");
  onStage({
    stage: "prepared",
    events: prepared.runtimeInputs.events.length,
    definitions: prepared.runtimeInputs.definitions.size,
    endTime: prepared.report.endTime,
  });
  const end = prepared.report.endTime;
  if (!Number.isFinite(end) || end < 120)
    throw Error("At least120 seconds of actual replay required");
  const times =
    end > 3000
      ? [0, 3022.7, 1500, 60, 2900, 0, 3022.7]
      : [0, end - 0.5, end / 2, 20.5, end - 10, 0, end - 0.5];
  if (times.some((time) => time > end))
    throw Error("Actual replay does not cover requested full-match comparison");
  const comparison = await compareCheckpointRuntime({
    runtimeInputs: prepared.runtimeInputs,
    runtimePair: prepared.runtimePair,
    times,
    camera: {
      right: [1, 0, 0],
      up: [0, 0.6, -0.8],
      axis: [0, 0.8, 0.6],
      position: [6000, 8000, 12000],
    },
    onStage,
  });
  await prepared.assertInputsUnchanged();
  if (
    new Bun.CryptoHasher("sha256")
      .update(await Bun.file(import.meta.path).bytes())
      .digest("hex") !== controlSha256
  )
    throw Error("Checkpoint comparison control changed during execution");
  const result = {
    kind: "actual-replay-original-versus-retained-checkpoint-cache",
    controlSha256,
    ...comparison,
    sourceCounts: {
      events: prepared.runtimeInputs.events.length,
      definitions: prepared.runtimeInputs.definitions.size,
      endTime: end,
    },
    replaySha256: prepared.report.replaySha256,
    preparationInputs: prepared.inputs,
    stages,
  };
  await Bun.write(
    join(outputDirectory, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      outputDirectory,
      matched: comparison.comparisons.length,
      comparisons: comparison.comparisons,
      sourceDrift: comparison.sourceDrift.length,
    }),
  );
} catch (error) {
  await Bun.write(
    join(outputDirectory, "failure.json"),
    JSON.stringify({ error: String(error), controlSha256, stages }, null, 2),
  );
  throw error;
}
