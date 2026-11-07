// Original component controls, never replay inputs or an invented missile basis.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { directConstantEmitterPosition } from "../latest-direct-effect-position.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const n = await read(
  `${cache}/research/direct-particle-orientation-bounded-native.json`,
);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
if (
  n.kind !== "native-bounded-particle-local-orientation-quad-controls" ||
  n.build !== profile.clientVersion ||
  n.protocol !== profile.protocolDigest ||
  n.decoderImageSha256 !== profile.decoderImageSha256 ||
  n.registration.offset !== 0x2d0 ||
  n.registration.type !== 0x87 ||
  n.registration.mask !== 2 ||
  n.scope.originalTypedReaderPostloadBooleanDefault !== true ||
  n.scope.authoredSerializedFieldOrderPreserved !== true ||
  n.scope.originalEmitterAndGeometry !== true ||
  n.scope.onlyParticleLocalBooleanVaried !== true ||
  n.scope.nativeMissileBasisRecovered !== false ||
  n.scope.gpuSubmitted !== false
)
  throw Error("Exact original particle-local typed component control required");
for (const [path, hash] of Object.entries(n.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale native input: ${path}`);
for (const [name, hash] of Object.entries(n.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Stale native producer: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  (await sha256(image)) !== profile.decoderImageSha256 ||
  !n.originalBlocks.length
)
  throw Error("Exact original instruction image required");
for (const b of n.originalBlocks)
  if ((await sha256(image.subarray(b.rva, b.rva + b.size))) !== b.sha256)
    throw Error("Original particle-local instruction bytes differ");
const zero = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => Object.is(v, 0));
function boundedSource(source) {
  const shape = source.SpawnShape;
  const offset =
    shape === undefined ? [0, 0, 0] : shape?.emitOffset?.constantValue;
  const position = directConstantEmitterPosition(source.EmitterPosition);
  return (
    (source.primitive === undefined ||
      source.primitive?.__type === "VfxPrimitiveCameraQuad") &&
    zero(offset) &&
    (position === undefined || zero(position)) &&
    (source.birthVelocity === undefined ||
      zero(source.birthVelocity?.constantValue))
  );
}
const seeds = ["0000000000000001", "0000000000012345"],
  poses = ["identity", "seven-bases"],
  variants = ["false", "true"],
  selected = new Map(),
  expected = new Set(),
  cases = new Map();
if (!Array.isArray(n.selected) || !n.selected.length)
  throw Error("Nonempty component matrix required");
for (const c of n.selected) {
  const key = JSON.stringify([c.effectId, c.emitterIndex]);
  if (selected.has(key)) throw Error("Duplicate selected component");
  selected.set(key, c);
  for (const seed of seeds)
    for (const pose of poses)
      for (const variant of variants)
        expected.add(
          JSON.stringify([c.effectId, c.emitterIndex, seed, pose, variant]),
        );
}
function visible(g) {
  const bytes = Uint8Array.fromHex(g.verticesHex),
    view = new DataView(bytes.buffer);
  if (!g.indicesHex) return false;
  for (let o = 0; o < bytes.length; o += 112) {
    const p = Array.from({ length: 3 }, (_, i) =>
      Array.from({ length: 3 }, (_, j) =>
        view.getFloat32(o + i * 28 + j * 4, true),
      ),
    );
    const a = p[1].map((v, i) => v - p[0][i]),
      b = p[2].map((v, i) => v - p[0][i]);
    if (
      bytes[o + 15] > 0 &&
      [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ].some((v) => v !== 0)
    )
      return true;
  }
  return false;
}
for (const c of n.cases) {
  const key = JSON.stringify([
    c.effectId,
    c.emitterIndex,
    c.seedHex,
    c.schedule,
    c.variant,
  ]);
  if (
    !expected.has(key) ||
    cases.has(key) ||
    c.frames.length !== 61 ||
    c.cameraPolicy !== "supplied-yaw-and-pitch-orbit"
  )
    throw Error("Exact unique 61-frame pose/flag matrix required");
  if (
    !c.frames.some((f) => f.output.state.births.length) ||
    !c.frames.some((f) => visible(f.output.geometry))
  )
    throw Error("Actual birth and positive colored indexed geometry required");
  c.frames.forEach((f, i) => {
    if (f.input.time !== i / 60)
      throw Error("Exact supplied 60Hz clock required");
  });
  const matrices = new Set(c.frames.map((f) => JSON.stringify(f.input.basis)));
  if (
    matrices.size !== (c.schedule === "identity" ? 1 : 7) ||
    new Set(c.frames.map((f) => JSON.stringify(f.input.cameraRight))).size < 2
  )
    throw Error(
      "Seven distinct root bases and orbiting camera inputs required",
    );
  cases.set(key, c);
}
if (cases.size !== expected.size)
  throw Error("Missing native orientation variants/poses/seeds");
const rows = [];
for (const c of selected.values()) {
  const bounded = boundedSource(c.source);
  let geometryDifferences = 0,
    orientationDifferences = 0;
  for (const seed of seeds) {
    const base = cases.get(
      JSON.stringify([c.effectId, c.emitterIndex, seed, "identity", "false"]),
    );
    for (const pose of poses)
      for (const variant of variants) {
        const row = cases.get(
          JSON.stringify([c.effectId, c.emitterIndex, seed, pose, variant]),
        );
        const absent = cases.get(
          JSON.stringify([c.effectId, c.emitterIndex, seed, pose, "false"]),
        );
        for (let i = 0; i < 61; i++) {
          const a = row.frames[i].output,
            b = absent.frames[i].output;
          if (
            JSON.stringify(row.frames[i].input) !==
            JSON.stringify(absent.frames[i].input)
          )
            throw Error("Flag comparison requires identical frame inputs");
          if (JSON.stringify(a.geometry) !== JSON.stringify(b.geometry))
            geometryDifferences++;
          if (bounded) {
            if (
              JSON.stringify(a.geometry) !==
              JSON.stringify(base.frames[i].output.geometry)
            )
              throw Error(
                "Bounded camera geometry depends on supplied root basis/flag",
              );
            const rest = (state) => ({
              ...state,
              vectors: Object.fromEntries(
                Object.entries(state.vectors).filter(
                  ([k]) => !["matrices", "particle"].includes(k),
                ),
              ),
            });
            if (JSON.stringify(rest(a.state)) !== JSON.stringify(rest(b.state)))
              throw Error(
                "Bounded camera flag changes birth/RNG/clocks/nonorientation streams",
              );
            if (
              JSON.stringify(rest(a.state)) !==
              JSON.stringify(rest(base.frames[i].output.state))
            )
              throw Error(
                "Bounded camera basis changes birth/RNG/clocks/nonorientation streams",
              );
            if (
              JSON.stringify(a.state.vectors) !==
              JSON.stringify(b.state.vectors)
            )
              orientationDifferences++;
          }
        }
      }
  }
  if (bounded && !orientationDifferences)
    throw Error(
      "Flag control never exercised retained orientation stream differences",
    );
  rows.push({
    effectId: c.effectId,
    emitterIndex: c.emitterIndex,
    boundedCameraZeroOffsetVelocity: bounded,
    geometryDifferences,
    orientationDifferences,
  });
}
if (
  !rows.some((r) => r.boundedCameraZeroOffsetVelocity) ||
  !rows.some(
    (r) => !r.boundedCameraZeroOffsetVelocity && r.geometryDifferences > 0,
  )
)
  throw Error(
    "Positive bounded camera and rejected nonzero/arbitrary counterexamples required",
  );
await raw(resolve(import.meta.filename));
await raw(resolve(import.meta.dir, "../latest-direct-effect-position.mjs"));
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const out = {
  schema: 1,
  kind: "verified-bounded-camera-particle-orientation-controls",
  components: rows,
  cases: cases.size,
  frames: cases.size * 61,
  exactGeometry: true,
  nativeOrientationStreamOmission:
    "native-particle-and-matrix-orientation-streams-unconsumed-by-camera-writer",
  scope: {
    suppliedClockSeedMotionBasisAndCamera: true,
    nativeMissileBasisRecovered: false,
    compilerAdmissionChanged: false,
    actualMatchActivated: false,
    gpuSubmitted: false,
  },
  inputs,
};
await Bun.write(
  `${cache}/research/direct-particle-orientation-comparison.json`,
  JSON.stringify(out, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    components: rows,
    cases: cases.size,
    frames: out.frames,
    pass: true,
  }),
);
