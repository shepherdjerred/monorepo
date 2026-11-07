import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createSuppliedRangeMissileTargetProjection } from "../latest-supplied-range-missile-target.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/projected-missile-endpoint-native-v35.json`,
);
for (const [path, digest] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale native endpoint input: ${path}`);
if (
  native.scope.actualEndpointAdmitted !== false ||
  !native.projectionScope.explicitSuppliedRangeControl ||
  native.projectionCases.length !== 96 ||
  native.heightOffsetCases.length !== 32 ||
  native.cases.length !== 4 ||
  native.slotDecode.length !== 256 ||
  native.originalMinimumRange !== 1
)
  throw Error("Scoped supplied-range original controls required");
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heights = await raw(`${cache}/public/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  ),
  projector = createSuppliedRangeMissileTargetProjection(
    await read(`${cache}/public/decoder-16.21-macos/missile-motion.json`),
  );
const mismatch = [],
  bits = (position) => {
    const view = new DataView(new ArrayBuffer(12));
    position.forEach((value, index) => view.setFloat32(index * 4, value, true));
    return Buffer.from(view.buffer).toString("hex");
  };
const controls = [...native.projectionCases, ...native.heightOffsetCases];
for (const row of controls) {
  const actual = projector.project({
    sourcePosition: row.sourcePosition,
    targetPosition: row.targetPosition,
    range: row.suppliedRange,
    initialTargetHeightOffset: row.initialTargetHeightOffset ?? 0,
    useGroundHeightAtTarget: row.mUseGroundHeightAtTarget,
    terrain,
  });
  if (!actual.resolved || bits(actual.position) !== row.positionHex)
    mismatch.push({
      sequence: row.sequence,
      suppliedRange: row.suppliedRange,
      groundFlag: row.mUseGroundHeightAtTarget,
      expected: row.positionHex,
      actual,
    });
}
if (mismatch.length)
  throw Error(
    `Original projected target mismatch: ${JSON.stringify(mismatch.slice(0, 5))}`,
  );
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Endpoint input changed: ${path}`);
const output = `${cache}/research/projected-missile-endpoint-comparison-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "supplied-range-projected-endpoint-original-comparison",
      inputs,
      cases: controls.length,
      float32Lanes: controls.length * 3,
      mismatches: [],
      scope: {
        originalFullHelperReturnCompared: true,
        actualCasterRangeRecovered: false,
        actualEndpointAdmitted: false,
        browserObserved: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: controls.length,
    float32Lanes: controls.length * 3,
    mismatches: 0,
    inputs: Object.keys(inputs).length,
  }),
);
