import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { directSoftDepthConversion } from "../latest-direct-soft-depth.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input changed: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const report = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/direct-soft-depth-native.json`),
  ),
);
if (
  report.kind !== "native-soft-depth-conversion-producer-controls" ||
  report.build !== "16.21.829.8620" ||
  report.protocol !== "20e09df23c66b85e" ||
  report.cases.length !== 10 ||
  report.originalBlocks.length !== 3
)
  throw Error("Complete original camera-pair producer controls required");
for (const [path, hash] of Object.entries(report.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale original depth producer: ${path}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of report.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original depth producer instruction bytes differ");
const cases = [],
  expectedPairs = new Set(
    [
      [1, 10000],
      [0.1, 1000],
      [100, 100000],
      [0.001, 10],
      [1e-8, 1e-4],
      [0, 0],
      [-1, 100],
      [100, 100],
      [1000, 0.1],
      [10000, 1],
    ].map((pair) => JSON.stringify(pair.map(Math.fround))),
  );
for (const row of report.cases) {
  const key = JSON.stringify(row.inputPair);
  if (!expectedPairs.delete(key))
    throw Error("Duplicate or unexpected camera pair control");
  const result = directSoftDepthConversion(row.inputPair),
    actual = new Uint8Array(result.buffer).toHex();
  if (actual !== row.outputHex)
    throw Error(`Original camera-pair depth conversion differs: ${key}`);
  cases.push({ inputPair: row.inputPair, outputHex: actual });
}
if (expectedPairs.size) throw Error("Missing original camera pair controls");
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-direct-soft-depth.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const output = `${cache}/research/direct-soft-depth-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-native-camera-pair-depth-conversion",
      cases,
      inputs,
      scope: {
        originalArithmeticAgreement: true,
        actualViewerCameraPairRecovered: false,
        originalNearFarSemanticMappingRecovered: false,
        sceneDepthProducerIntegrated: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    float32Scalars: cases.length * 4,
    pass: true,
  }),
);
