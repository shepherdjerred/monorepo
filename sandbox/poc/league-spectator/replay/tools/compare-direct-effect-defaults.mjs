import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import {
  DIRECT_POINT_DEFAULT_BITS,
  normalizeDirectPointEmitter,
} from "../latest-direct-effect-defaults.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    hash = await sha256(data);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Default input drift:" + path);
  inputs[path] = hash;
  return data;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    cache + "/research/direct-effect-defaults-native.json",
  ),
  profile = await read(cache + "/public/decoder-16.21-macos/profile.json"),
  image = await raw(cache + "/public/decoder-16.21-macos/image.bin");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(native.constructorRva, 0x16ffef0);
assert.equal(native.scope.completeOriginalEmitterConstructor, true);
assert.equal(native.pointerDefaults?.SpawnShape?.pointer, 0);
assert.equal(native.pointerDefaults.SpawnShape.registration.offset, 0x238);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash, path);
for (const [name, hash] of Object.entries(native.sources))
  assert.equal(
    await sha256(await raw(resolve(import.meta.dir, name))),
    hash,
    name,
  );
const init = native.staticInitializer,
  copy = native.birthScaleConstructorCopy;
assert.equal(init.startRva, 0x14aa3bf);
assert.equal(init.endRva, 0x14aa516);
assert.equal(init.unitVectorRva, 0x256cb28);
assert.equal(
  init.afterHex,
  new Uint8Array(new Float32Array([1, 1, 1]).buffer).toHex(),
);
assert.equal(copy.startRva, 0x1700325);
assert.equal(copy.endRva, 0x1700338);
for (const b of [init, copy, native.nullShapeBirthBranch])
  assert.equal(await sha256(image.subarray(b.startRva, b.endRva)), b.sha256);
for (const [name, bits] of Object.entries(DIRECT_POINT_DEFAULT_BITS))
  assert.deepEqual(bits, native.fields[name]?.bits, name);
assert.equal(native.fields.birthScale0.registration.offset, 0x3e8);
const authored = {
    bindWeight: null,
    birthScale0: { __type: "ValueVector3", constantValue: [1, 2, 3] },
  },
  normalized = normalizeDirectPointEmitter(authored);
assert.equal(normalized.bindWeight, null);
assert.equal(normalized.birthScale0, authored.birthScale0);
assert(!Object.hasOwn(authored, "lifetime"));
const zero = { __type: "ValueVector3", constantValue: [0, 0, 0] };
assert.equal(
  normalizeDirectPointEmitter({ birthScale0: zero }).birthScale0,
  zero,
);
assert.deepEqual(
  normalizeDirectPointEmitter({}).birthScale0.constantValue,
  [1, 1, 1],
);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = cache + "/research/direct-effect-defaults-comparison.json";
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "initialized-original-emitter-numeric-defaults-comparison",
      inputs,
      fields: Object.keys(DIRECT_POINT_DEFAULT_BITS).length,
      mismatches: [],
      scope: {
        originalStaticInitializerAndConstructor: true,
        originalRegisteredFieldOffsets: true,
        authoredValuesPreserved: true,
        containsReplayEvents: false,
        liveWorldBindings: false,
        browserPlayback: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    fields: Object.keys(DIRECT_POINT_DEFAULT_BITS).length,
    mismatches: 0,
  }),
);
