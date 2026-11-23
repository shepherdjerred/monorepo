// Full original data versus the actual compact/projected worker wire contract.
import path from "node:path";
import assert from "node:assert/strict";
import { compactReplayReport } from "../latest-replay-columns.mjs";
import {
  projectLatestDirectWorldInput,
  consumeLatestDirectWorldInput,
  restoreLatestDirectWorldInput,
} from "../latest-direct-world-input.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [reportArg, sceneArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun compare-neutral-world-input.mjs <complete-semantic-report> <runtime/public/latest-scene> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function digest(file) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
}
async function read(file) {
  inputs[path.resolve(file)] = await digest(file);
  return Bun.file(file).json();
}
const scene = await read(path.join(sceneArg, "manifest.json")),
  report = await read(reportArg),
  heightsPath = path.join(sceneArg, "heights.bin"),
  heights = await Bun.file(heightsPath).arrayBuffer();
inputs[path.resolve(heightsPath)] = sha(new Uint8Array(heights));
const heightEntry = scene.files.find((entry) => entry.path === "heights.bin");
if (
  !heightEntry ||
  heightEntry.sha256 !== inputs[path.resolve(heightsPath)] ||
  heightEntry.bytes !== heights.byteLength
)
  throw Error("Original selected map height inventory required");
if (
  scene.map.id !== 11 ||
  !Array.isArray(report.neutralCreations) ||
  !report.neutralCreations.length
)
  throw Error("Actual Map11 neutral gameplay report required");
const sources = {};
await captureDirectSourceInputs([import.meta.path], async (file) => {
  const bytes = await Bun.file(file).bytes();
  sources[path.resolve(file)] = sha(bytes);
  return bytes;
});
const packed = compactReplayReport(report),
  owned = projectLatestDirectWorldInput(packed),
  transfer = consumeLatestDirectWorldInput(owned.ownership, owned.input),
  wire = structuredClone(owned.input, { transfer }),
  received = restoreLatestDirectWorldInput(wire);
assert.deepStrictEqual(received.neutralCreations, report.neutralCreations);
assert.deepStrictEqual(received.neutralSnapshots, report.neutralSnapshots);
const terrain = createLatestTerrain(scene, new Float32Array(heights)),
  make = (source) =>
    createLatestWorldPresentation({ report: source, scene, terrain }),
  original = make(report),
  projected = make(received),
  ids = new Set(report.neutralCreations.map((row) => row.entityId)),
  cases = [],
  domains = {};
function append(domain, rows) {
  let count = 0;
  for (const row of rows)
    if (ids.has(row.entityId)) {
      if (
        !Number.isFinite(row.time) ||
        !Number.isSafeInteger(row.transportSequence)
      )
        throw Error("Original causal neutral source row required");
      cases.push({
        domain,
        entityId: row.entityId,
        time: row.time,
        transportSequence: row.transportSequence,
        entryOrder: row.entryOrder ?? row.recordIndex ?? 0,
      });
      count++;
    }
  domains[domain] = count;
}
append("gameplayCreation", report.neutralCreations);
append("snapshotInventory", report.neutralSnapshots);
append("movement", report.movement);
append("lifecycle", report.lifecycle);
append("visibility", report.visibilityRequests);
append("replication", report.replicationRecords);
append("animation", report.animations);
append("attacks", report.attacks);
append("casts", report.casts);
for (const entityId of ids) {
  cases.push(
    { domain: "windowBoundary", entityId, time: 0 },
    { domain: "windowBoundary", entityId, time: report.endTime },
  );
}
cases.sort(
  (a, b) =>
    a.time - b.time ||
    (a.transportSequence ?? 0) - (b.transportSequence ?? 0) ||
    a.entryOrder - b.entryOrder,
);
const counts = {
  entity: 0,
  visibility: 0,
  presentationTarget: 0,
  unavailablePoseComparisons: 0,
};
for (const reverse of [false, true]) {
  const indices = reverse
    ? Array.from({ length: cases.length }, (_, i) => cases.length - i - 1)
    : cases.keys();
  for (const index of indices) {
    const sample = cases[index],
      cursor =
        sample.transportSequence === undefined
          ? null
          : {
              transportSequence: sample.transportSequence,
              entryOrder: sample.entryOrder,
              exclusive: reverse,
            };
    for (const method of ["entity", "visibility", "presentationTarget"]) {
      assert.deepStrictEqual(
        projected[method](sample.entityId, sample.time, cursor),
        original[method](sample.entityId, sample.time, cursor),
        `${method} differs at ${sample.domain}/${sample.entityId}/${sample.time}/${reverse}`,
      );
      counts[method]++;
    }
    // Equality of unavailable pose results is a wire regression check only.
    const pose = original.viewerPose(sample.entityId, [0], sample.time, cursor);
    if (pose.resolved !== false)
      throw Error("This diagnostic must not claim actual pose assets");
    assert.deepStrictEqual(
      projected.viewerPose(sample.entityId, [0], sample.time, cursor),
      pose,
    );
    counts.unavailablePoseComparisons++;
  }
}
for (const [file, expected] of Object.entries(inputs))
  if ((await digest(file)) !== expected)
    throw Error("Neutral comparison input changed: " + file);
for (const [file, expected] of Object.entries(sources))
  if (sha(await Bun.file(file).bytes()) !== expected)
    throw Error("Neutral comparison consumer source changed: " + file);
const result = {
  schema: 1,
  kind: "actual-neutral-worker-world-input-comparison",
  inputs,
  sources,
  toolSha256: sha(await Bun.file(import.meta.path).bytes()),
  entities: ids.size,
  gameplayCreations: report.neutralCreations.length,
  snapshotsRetainedSeparately: report.neutralSnapshots.length,
  domains,
  causalSamples: cases.length,
  counts,
  scope: {
    fullOriginalSourceRetained: true,
    actualCompactProjectionWireCloneCompared: true,
    everyListedSourceRowComparedForwardInclusiveAndBackwardExclusive: true,
    originalMapHeightGridUsed: true,
    poseAssetsAvailable: false,
    renderedActors: false,
    nativeFactoryAccepted: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    entities: ids.size,
    domains,
    causalSamples: cases.length,
    counts,
    poseAssetsAvailable: false,
  }),
);
