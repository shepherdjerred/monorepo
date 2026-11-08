import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY } from "../latest-direct-effect-camera-mesh-flags.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    hash = await sha256(b);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Zero mesh flags input drift");
  inputs[path] = hash;
  return b;
}
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-zero-mesh-flags-native.json`,
  ),
  uv = await read(`${cache}/research/direct-quad-uv-schedule-comparison.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(native.kind, "original-zero-mesh-render-flag-controls");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(await sha256(image), profile.decoderImageSha256);
for (const p of [native, uv])
  for (const [path, h] of Object.entries(p.inputs))
    assert.equal(await sha256(await raw(path)), h, path);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
assert.equal(native.registration.hash, 0x19bdf4df);
assert.equal(native.registration.offset, 0x73);
assert.equal(native.registration.type, 3);
const post = new Map(native.postloads.map((p) => [p.variant, p]));
assert.equal(post.size, 3);
const zero = post.get("authored-zero"),
  absent = post.get("absent"),
  one = post.get("typed-one-control");
assert.equal(zero.fieldBytesHex, "00");
assert.equal(absent.fieldBytesHex, "01");
assert.equal(one.fieldBytesHex, "01");
assert.equal(zero.heapSha256, absent.heapSha256);
assert.equal(zero.heapBytes, absent.heapBytes);
assert.equal(absent.objectHex, one.objectHex);
const a = Uint8Array.fromHex(zero.objectHex),
  b = Uint8Array.fromHex(absent.objectHex);
assert.equal(a.length, 0x470);
assert.deepEqual(
  [...a.keys()].filter((i) => a[i] !== b[i]),
  [0x73],
);
assert.equal(native.cases.length, 8);
let frames = 0,
  births = 0,
  positiveGeometryFrames = 0;
for (const seedHex of ["0000000000000001", "0000000000012345"])
  for (const pose of ["identity", "changing"]) {
    const pair = native.cases.filter(
      (c) => c.seedHex === seedHex && c.pose === pose,
    );
    assert.equal(pair.length, 2);
    const zero = pair.find((c) => c.variant === "authored-zero"),
      absent = pair.find((c) => c.variant === "absent");
    assert.equal(zero.frames.length, 61);
    assert.deepEqual(zero.frames, absent.frames);
    let born = 0,
      positive = 0;
    for (const [i, frame] of zero.frames.entries()) {
      assert.equal(frame.input.time, i / 60);
      born += frame.output.state.births.length;
      positive += Number(frame.output.geometry.verticesHex.length > 0);
    }
    assert(born > 0 && positive > 0);
    frames += zero.frames.length * 2;
    births += born;
    positiveGeometryFrames += positive;
  }
assert.equal(frames, 488);
assert.equal(uv.mismatches.length, 0);
assert.equal(uv.counts.components, 6);
assert.equal(uv.counts.frames, 736);
assert.equal(uv.omittedNativeComponents.length, 0);
const compiledCases = uv.cases.filter(
  (c) =>
    c.effectId === native.effectId && c.emitterIndex === native.emitterIndex,
);
assert.equal(compiledCases.length, 2);
assert.equal(
  compiledCases.reduce((n, c) => n + c.frames, 0),
  122,
);
const load = (file) => raw(`${cache}/public/${file}`),
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [native.effectId],
  }),
  definition = prepared.definitions.get(native.effectId),
  emitter = definition.emitters.find((e) => e.index === native.emitterIndex);
assert.equal(definition.blockers.length, 0);
assert.equal(emitter.primitive, "camera-quad");
assert.equal(emitter.source.meshRenderFlags, 0);
assert.equal(
  emitter.meshRenderFlagsPolicy,
  DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY,
);
for (const [path, h] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    h,
    "Final zero flag drift",
  );
const output = `${cache}/research/direct-zero-mesh-flags-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "native-camera-quad-zero-mesh-flags-comparison",
      inputs,
      effectId: native.effectId,
      emitterIndex: native.emitterIndex,
      policy: DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY,
      nativeDefault: 1,
      explicitValue: 0,
      nativeFrames: frames,
      births,
      positiveGeometryFrames,
      compiledFrames: 122,
      mismatches: [],
      scope: {
        originalTypedValuePreserved: true,
        particleStateAndGeometryCompared: true,
        sourceMaterialAlreadyPreparedSeparately: true,
        otherPrimitivesAdmitted: false,
        nonzeroAuthoredFlagsAdmitted: false,
        actualMatchPlacementEstablished: false,
        gpuSubmittedByThisControl: false,
        nativeWorldAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    nativeFrames: frames,
    compiledFrames: 122,
    inputs: Object.keys(inputs).length,
    mismatches: 0,
  }),
);
