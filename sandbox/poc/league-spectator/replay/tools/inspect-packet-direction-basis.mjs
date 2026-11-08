import { resolve } from "node:path";
import {
  createLatestPacketDirectionBasis,
  PACKET_DIRECTION_BASIS_BLOCKS,
} from "../latest-packet-direction-basis.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const bytes = async (path) => {
  const b = await Bun.file(path).bytes();
  inputs[resolve(path)] = await sha256(b);
  return b;
};
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const native = await json(
  `${cache}/research/packet-direction-basis-native.json`,
);
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`);
for (const [path, digest] of Object.entries({
  ...native.inputs,
  ...native.sources,
}))
  if ((await sha256(await bytes(path))) !== digest)
    throw Error(`Native input changed: ${path}`);
const image = await bytes(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Original image changed");
for (const [rva, size, digest] of PACKET_DIRECTION_BASIS_BLOCKS)
  if ((await sha256(image.subarray(rva, rva + size))) !== digest)
    throw Error("Original direction instructions changed");
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-packet-direction-basis.mjs"),
  resolve(import.meta.dir, "../latest-root-attachment-provider.mjs"),
])
  await bytes(path);
const kernel = createLatestPacketDirectionBasis(profile);
for (const c of native.cases) {
  const b = kernel.horizontal(c.direction),
    matrix = new Float32Array([
      b[0],
      b[1],
      b[2],
      0,
      b[3],
      b[4],
      b[5],
      0,
      b[6],
      b[7],
      b[8],
      0,
      0,
      0,
      0,
      1,
    ]);
  const actual = Buffer.from(matrix.buffer).toString("hex");
  if (actual !== c.matrixHex)
    throw Error(
      `Packet direction basis differs: ${JSON.stringify(c.direction)}\n${actual}\n${c.matrixHex}`,
    );
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Input drift: ${path}`);
const out = `${cache}/research/packet-direction-basis-comparison.json`;
await Bun.write(
  out,
  JSON.stringify({
    schema: 1,
    kind: "native-browser-packet-direction-basis-comparison",
    inputs,
    controls: native.cases.length,
    actualDirectionControls: native.actualDirectionControls,
    differences: 0,
    scope: native.scope,
  }),
);
console.log(
  JSON.stringify({
    output: out,
    controls: native.cases.length,
    differences: 0,
    fingerprints: Object.keys(inputs).length,
  }),
);
