import { resolve } from "node:path";
import {
  buildParentMissileBursts,
  PARENT_MISSILE_POLICY,
} from "../latest-parent-missile-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (path) => {
    const b = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(b);
    return b;
  };
const bytes = await raw(`${cache}/research/bound-vfx-playback.json`),
  source = JSON.parse(new TextDecoder().decode(bytes));
if (
  source.kind !== "complete-quad-replay-composition" ||
  source.build !== "16.21.829.8620" ||
  source.protocol !== "20e09df23c66b85e" ||
  !source.scope.activationAtMissileStart ||
  source.traces.length !== 30
)
  throw Error("Unexpected decoded parent missile fixture");
for (const [path, digest] of Object.entries(source.inputs))
  if (sha(await raw(path)) !== digest)
    throw Error(`Decoded parent missile input changed: ${path}`);
for (const [name, digest] of Object.entries(source.sources))
  if (sha(await raw(`${root}/${name}`)) !== digest)
    throw Error(`Decoded parent missile producer changed: ${name}`);
const bursts = buildParentMissileBursts(source.traces),
  sources = {};
for (const name of [
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "tools/prepare-parent-missile-inputs.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "replay-derived-parent-missile-inputs",
  build: source.build,
  protocol: source.protocol,
  sourceSha256: sha(bytes),
  inputs,
  sources,
  policy: PARENT_MISSILE_POLICY,
  camera: source.camera,
  bursts,
  counts: {
    bursts: bursts.length,
    parents: bursts.reduce((n, b) => n + b.parents.length, 0),
    worldFrames: bursts.reduce((n, b) => n + b.frames.length, 0),
    parentUpdates: bursts.reduce(
      (n, b) => n + b.frames.reduce((n, f) => n + f.updates.length, 0),
      0,
    ),
  },
  scope: {
    decodedMissileTrajectories: true,
    suppliedActivationStopSeedBasis: true,
    originalEffectEventMapping: false,
    originalSeedAndJobOrdering: false,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-missile-inputs.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ counts: result.counts, sourceSha256: result.sourceSha256 }),
);
