// Native coordinate/packing proof only. Material raster is a separate gate.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { directDefaultParticlePalette } from "../latest-direct-particle-palette.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const data = await Bun.file(path).bytes(),
    digest = await sha256(data);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Palette input drift");
  inputs[path] = digest;
  return data;
}
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await json(
    `${cache}/research/direct-particle-palette-native.json`,
  ),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  native.kind !== "native-particle-palette-coordinate-controls" ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  (await sha256(image)) !== profile.decoderImageSha256 ||
  !native.originalBlocks?.length ||
  !native.materialBlocks?.length
)
  throw Error("Exact original palette execution required");
for (const [path, digest] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Palette native input differs: ${path}`);
for (const [path, digest] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(root, "tools", path)))) !== digest)
    throw Error(`Palette native source differs: ${path}`);
for (const block of [...native.originalBlocks, ...native.materialBlocks])
  if (
    !Number.isSafeInteger(block.rva) ||
    !Number.isSafeInteger(block.size) ||
    block.rva < 0 ||
    block.size <= 0 ||
    block.rva + block.size > image.length ||
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
  )
    throw Error("Palette original instruction block differs");
const exact = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  identities = [
    "champions/karthus/10/fde333aa:0",
    "champions/jinx/2/953aab68:1",
    "champions/maokai/3/b9d05a01:0",
    "champions/maokai/3/99dd2080:0",
  ],
  cases = new Map();
for (const value of native.cases) {
  const id = `${value.effectId}:${value.emitterIndex}:${value.seedHex}:${value.variant}`;
  if (cases.has(id)) throw Error("Duplicate palette native case");
  cases.set(id, value);
}
let frames = 0,
  controllerInputs = 0,
  packedCoordinates = 0;
for (const identity of identities)
  for (const seed of ["0000000000000001", "0000000000012345"]) {
    const a = cases.get(`${identity}:${seed}:authored`),
      b = cases.get(`${identity}:${seed}:absent`);
    if (!a || !b || a.frames.length !== 61 || !exact(a.frames, b.frames))
      throw Error("Complete authored/absent palette state and geometry differ");
    let births = 0,
      positiveGeometry = 0;
    for (let tick = 0; tick <= 60; tick++) {
      const frame = a.frames[tick];
      if (frame.input.time !== tick / 60)
        throw Error("Exact palette clocks required");
      births += frame.output.state.births.length;
      const vertices = Uint8Array.fromHex(frame.output.geometry.verticesHex),
        indices = Uint8Array.fromHex(frame.output.geometry.indicesHex),
        view = new DataView(vertices.buffer);
      if (vertices.length % 28 || indices.length % 6)
        throw Error("Exact native palette vertex layout required");
      if (vertices.length / 112 !== frame.controllerInputs.length)
        throw Error("Every native particle requires controller evidence");
      for (
        let particle = 0;
        particle < frame.controllerInputs.length;
        particle++
      ) {
        const input = frame.controllerInputs[particle];
        if (
          !exact(input.modes, [1, 0]) ||
          !exact(input.coefficients, [1, 1, 0, 0])
        )
          throw Error("Only default native palette selectors are established");
        const expected = [...directDefaultParticlePalette(input.normalizedAge)];
        for (let corner = 0; corner < 4; corner++) {
          const offset = (particle * 4 + corner) * 28 + 24;
          if (
            !exact(
              [view.getUint16(offset, true), view.getUint16(offset + 2, true)],
              expected,
            )
          )
            throw Error("Packed native palette coordinates differ");
          packedCoordinates += 2;
        }
        controllerInputs++;
      }
      const point = (index) =>
        [0, 1, 2].map((axis) => view.getFloat32(index * 28 + axis * 4, true));
      const iv = new DataView(indices.buffer);
      for (let offset = 0; offset < indices.length; offset += 6) {
        const [a, b, c] = [0, 2, 4].map((lane) =>
            point(iv.getUint16(offset + lane, true)),
          ),
          u = b.map((value, i) => value - a[i]),
          v = c.map((value, i) => value - a[i]);
        if (
          Math.hypot(
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
          ) > 0
        )
          positiveGeometry++;
      }
      frames++;
    }
    if (!births || !positiveGeometry)
      throw Error("Nonempty positive native palette geometry required");
  }
if (cases.size !== 16) throw Error("Exact sixteen native cases required");
const expectedFractions = [
  ...new Set([
    0,
    2 ** -24,
    2 ** -14,
    0.0001,
    1 / 24,
    0.25,
    0.5,
    0.500244140625,
    0.9999,
    1,
    ...Array.from({ length: 61 }, (_, i) => i / 60),
  ]),
].sort((a, b) => a - b);
if (
  !exact(
    native.leafControls.map((row) => row.fraction),
    expectedFractions,
  )
)
  throw Error("Exact unique palette leaf-control matrix required");
for (const row of native.leafControls)
  if (
    !exact(row.coordinates, [
      Math.fround(Math.fround(Math.fround(row.fraction) * 1) + 0),
      1,
    ]) ||
    !exact(row.halfWords, [...directDefaultParticlePalette(row.fraction), 0, 0])
  )
    throw Error("Original palette arithmetic/half conversion differs");
for (const file of [
  import.meta.path,
  resolve(root, "latest-direct-particle-palette.mjs"),
  resolve(root, "latest-direct-effect-trail.mjs"),
])
  await raw(file);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Final palette proof input drift");
const output = `${cache}/research/direct-particle-palette-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "default-native-particle-palette-coordinate-comparison",
      inputs,
      frames,
      controllerInputs,
      packedCoordinates,
      arithmeticAndHalfControls: native.leafControls.length,
      differences: [],
      scope: {
        gpuSubmitted: false,
        runtimeAdmissionChanged: false,
        actualMatchActivation: false,
        authoredDefaultSelectorsOnly: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    frames,
    controllerInputs,
    packedCoordinates,
    arithmeticAndHalfControls: native.leafControls.length,
  }),
);
