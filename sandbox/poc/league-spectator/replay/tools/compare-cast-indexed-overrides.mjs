import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  readCastIndexedOverrideCount,
  requireEmptyCastIndexedOverrides,
} from "../latest-cast-indexed-overrides.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Indexed override input changed");
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(
  `${cache}/research/cast-indexed-overrides-native.json`,
);
if (
  native.kind !== "original-indexed-cast-override-producer-controls" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.layout.packetCountOffset !== 0x60 ||
  native.layout.travelTimeIndex !== 0
)
  throw Error("Exact original indexed override controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Override native fixture changed");
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Override native producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Override image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error("Original override instructions changed");
const fixtures = {};
for (const name of new Set(native.records.map((r) => r.source)))
  fixtures[name] = await read(`${cache}/research/${name}`);
const mismatches = [];
for (const row of native.records) {
  const observation = fixtures[row.source].observations[row.key],
    object = Uint8Array.fromHex(observation.object),
    count = readCastIndexedOverrideCount(object, row.opcode === 28 ? 168 : 24),
    result = requireEmptyCastIndexedOverrides({ indexedOverrideCount: count });
  if (
    count !== row.indexedOverrideCount ||
    !result.resolved ||
    result.travelTimeOverride !== null ||
    row.result.travelTimeOverrideFound !== false
  )
    mismatches.push(row.key);
}
let guards = 0;
for (const count of [1, 2, 0xffffffff]) {
  if (
    requireEmptyCastIndexedOverrides({ indexedOverrideCount: count }).resolved
  )
    throw Error("Nonempty override list admitted");
  guards++;
}
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-cast-indexed-overrides.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await raw(path);
const output = `${cache}/research/cast-indexed-overrides-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: native.build,
      protocol: native.protocol,
      kind: "cast-indexed-overrides-comparison",
      inputs,
      packets: native.records.length,
      originalNonemptyControls: native.controls.length,
      nonemptyAdmissionGuards: guards,
      mismatches,
      scope: native.scope,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    packets: native.records.length,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length)
  throw Error("Indexed override count disagrees with original producer");
