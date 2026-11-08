// Exact before/after actual-worker output control, independently of timing.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "../latest-direct-effect-runtime.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { directExactValueHash } from "./direct-exact-value-hash.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  baselineMode = process.argv.includes("--baseline"),
  producer = resolve(import.meta.dir, "inspect-initial-resource-playback.mjs"),
  source = await Bun.file(producer).text(),
  boundary = "const within = (row)";
assert.equal(source.indexOf(boundary), source.lastIndexOf(boundary));
assert.ok(source.indexOf(boundary) > 0);
const setup = source
    .slice(0, source.indexOf(boundary))
    .replace(
      /\bfrom\s+(["'])(\.{1,2}\/[^"']+)\1/g,
      (_m, _q, p) =>
        `from ${JSON.stringify(pathToFileURL(resolve(dirname(producer), p)).href)}`,
    )
    .replaceAll("import.meta.dir", JSON.stringify(dirname(producer)))
    .replaceAll("import.meta.path", JSON.stringify(producer)),
  setupPath = `${cache}/research/direct-v33-equivalence.setup.mjs`;
await Bun.write(setupPath, setup + "\nexport{payload,inputs,camera};\n");
const { payload, inputs, camera } = await import(pathToFileURL(setupPath).href);
await captureDirectSourceInputs([import.meta.path], async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[resolve(path)] = await sha256(bytes);
  return bytes;
});
inputs[setupPath] = await sha256(await Bun.file(setupPath).bytes());
const records = [],
  counts = {
    packets: 0,
    checkpoints: 0,
    positiveDrawPackets: 0,
    cameraPackets: 0,
    seekPackets: 0,
  },
  initializations = [];
function packet(label, p) {
  records.push({
    label,
    time: p.time,
    hash: directExactValueHash({ time: p.time, draws: p.draws }),
  });
  counts.packets++;
  counts.positiveDrawPackets += p.draws.length > 0;
}
async function checkpoint(client, label) {
  const state = await client.checkpoint();
  assert.equal(state.contract.runtimeVersion, DIRECT_EFFECT_PROGRAM_VERSION);
  state.contract.runtimeVersion = 0;
  records.push({ label, time: state.time, hash: directExactValueHash(state) });
  counts.checkpoints++;
  return state;
}
for (const step of [1, 4]) {
  const client = new LatestDirectEffectClient();
  try {
    initializations.push(await client.initialize(payload));
    for (let tick = 0; tick <= 1800; tick += step) {
      const time = 69 + tick / 60;
      packet(`${step}x:frame:${tick}`, await client.frame(time, camera));
      if (tick % 120 === 0)
        await checkpoint(client, `${step}x:checkpoint:${tick}`);
    }
    const terminal = await checkpoint(client, `${step}x:terminal`);
    const cameras = [
      camera,
      {
        right: [0, 0, -1],
        up: [0, 1, 0],
        axis: [1, 0, 0],
        position: [12000, 8000, 6000],
      },
      camera,
    ];
    for (const [i, view] of cameras.entries()) {
      const p = await client.camera(view);
      assert.equal(p.metrics.simulationStepsAdvanced, 0);
      packet(`${step}x:camera:${i}`, p);
      counts.cameraPackets++;
      const current = await checkpoint(client, `${step}x:camera-state:${i}`);
      assert.equal(
        directExactValueHash(current),
        directExactValueHash(terminal),
      );
    }
    for (const [ordinal, time] of [
      68, 72.3, 81.26666666666667, 70, 99, 70, 99,
    ].entries()) {
      packet(`${step}x:seek:${ordinal}`, await client.frame(time, camera));
      await checkpoint(client, `${step}x:seek-state:${ordinal}`);
      counts.seekPackets++;
    }
  } finally {
    client.close();
    await client.termination;
  }
}
assert.ok(counts.positiveDrawPackets > 0);
const baselinePath = `${cache}/research/direct-v33-equivalence-baseline-v32.json`,
  output = baselineMode
    ? baselinePath
    : `${cache}/research/direct-v33-equivalence-current.json`,
  mismatches = [];
let baselineSha256 = null;
if (!baselineMode) {
  const bytes = await Bun.file(baselinePath).bytes(),
    baseline = JSON.parse(new TextDecoder().decode(bytes));
  baselineSha256 = await sha256(bytes);
  assert.equal(baseline.kind, "actual-worker-lossless-output-equivalence");
  assert.equal(baseline.replayHash, payload.contract.replayHash);
  assert.equal(baseline.contentHash, payload.contract.contentHash);
  assert.equal(baseline.records.length, records.length);
  for (let i = 0; i < records.length; i++)
    if (
      !Object.is(baseline.records[i].time, records[i].time) ||
      baseline.records[i].label !== records[i].label ||
      baseline.records[i].hash !== records[i].hash
    )
      mismatches.push({
        ordinal: i,
        expected: baseline.records[i],
        actual: records[i],
      });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final input drift ${path}`,
  );
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-worker-lossless-output-equivalence",
      programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
      replayHash: payload.contract.replayHash,
      contentHash: payload.contract.contentHash,
      inputs,
      counts,
      records,
      initializations,
      baselinePath: baselineMode ? null : baselinePath,
      baselineSha256,
      mismatches,
      normalization: [
        "Draw packet metrics omitted: measured timing and transport only; packet.time and complete draws retained",
        "Checkpoint contract.runtimeVersion set to0 only; all other contract, clock, cursor, generations, ledger, provenance, omissions, particles and RNG retained",
      ],
      encoding:
        "Type-delimited SHA256 stream; scalar binary64 and typed-view raw bytes, preserving signed zero; own object keys sorted",
      scope: {
        actualModuleWorkers: true,
        completeActualOrderedEvents: true,
        oneAndFourTimes: true,
        cameraWithoutSimulation: true,
        backwardRepeatedSeeks: true,
        timingGate: false,
        browserAcceptance: false,
        gpuSubmission: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    records: records.length,
    mismatches: mismatches.length,
    first: mismatches.slice(0, 3),
  }),
);
if (mismatches.length) process.exitCode = 1;
