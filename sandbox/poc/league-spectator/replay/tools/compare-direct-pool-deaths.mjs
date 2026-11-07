import { resolve } from "node:path";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "../latest-direct-effect-runtime.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { normalizeDirectSystemAudio } from "../latest-direct-effect-audio.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  inputs[path] = await sha256(raw);
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const native = await read(`${cache}/research/direct-pool-deaths-native.json`);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
if (
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion
)
  throw Error("Native pool control build differs");
for (const [file, expected] of Object.entries(native.sources))
  if ((await sha256(await bytes(resolve(import.meta.dir, file)))) !== expected)
    throw Error(`Native pool producer changed: ${file}`);
const packages = Object.fromEntries(
  await Promise.all(
    ["values", "birth", "emission", "samplers"].map(async (name) => [
      name,
      await bytes(`${cache}/public/decoder-16.21-macos/vfx-${name}.json`),
    ]),
  ),
);
const kernels = await createDirectEffectKernels({ profile, packages });
const contract = {
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  contentHash: "a".repeat(64),
  replayHash: "b".repeat(64),
};
const d = {
  programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
  systemAudio: normalizeDirectSystemAudio({}),
  ...contract,
  id: "pool-control",
  unsupported: [],
  emitters: [
    {
      index: 0,
      source: native.emitter,
      placementRequirements: { rootBasis: true, boundObjectSize: null },
      primitive: "arbitrary-quad",
      offset: [0, 0, 0],
      bound: false,
      delay: 0,
      lifetime: 1,
      single: true,
      uniformScale: false,
      materialKey: "pool-control:0",
    },
  ],
};
const mismatches = [];
for (const reference of native.cases) {
  const runtime = new LatestDirectEffectRuntime({
    ...contract,
    kernels,
    definitions: new Map([[d.id, d]]),
    world: {
      placement: () => ({
        resolved: true,
        position: [0, 0, 0],
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        boundObjectSize: 0,
        boundObjectSizeStatus: "supplied-native-component-control-zero",
      }),
    },
    events: [
      {
        id: "pool-control:0",
        origin: "animation",
        kind: "create",
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        entityId: 1,
        definitionId: d.id,
        seedHex: native.seedHex,
      },
    ],
  });
  runtime.advanceTo(0);
  const saved = runtime.checkpoint();
  const e = saved.instances[0][1].emitters[0];
  if (e.count !== 4) throw Error("Direct burst did not create four particles");
  for (let i = 0; i < 4; i++) {
    e.data[i * 20] = i / 1000;
    e.data[i * 20 + 1] = reference.expired.includes(i) ? 0.1 : 1;
  }
  runtime.restore(saved);
  runtime.advanceTo(0.2);
  const after = runtime.checkpoint().instances[0][1].emitters[0];
  const identities = Array.from({ length: 4 }, (_, i) => Math.fround(i / 1000));
  const survivors = Array.from({ length: after.count }, (_, i) =>
    identities.indexOf(after.data[i * 20]),
  );
  if (JSON.stringify(survivors) !== JSON.stringify(reference.survivors))
    mismatches.push({ ...reference, actual: survivors });
}
for (const file of [
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-orientation.mjs",
  "latest-direct-effect-integrated-rotation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
  "tools/compare-direct-pool-deaths.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const result = {
  schema: 1,
  cases: native.cases.length,
  mismatches,
  inputs,
  scope: native.scope,
};
await Bun.write(
  `${cache}/research/direct-pool-deaths-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ cases: result.cases, mismatches }));
if (mismatches.length) process.exitCode = 1;
