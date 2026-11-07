import { resolve } from "node:path";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import { sampleDirectEffectBirth } from "../latest-direct-effect-birth.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  inputs[path] = await sha256(raw);
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const root = `${cache}/public`;
const profile = await read(`${root}/decoder-16.21-macos/profile.json`);
const packages = Object.fromEntries(
  await Promise.all(
    ["values", "birth", "emission", "samplers"].map(async (name) => [
      name,
      await bytes(`${root}/decoder-16.21-macos/vfx-${name}.json`),
    ]),
  ),
);
const kernels = await createDirectEffectKernels({ profile, packages });
const metaBytes = await bytes(
  `${root}/decoder-16.21-macos/vfx-point-quads.json`,
);
const meta = JSON.parse(new TextDecoder().decode(metaBytes));
const native = await read(`${cache}/research/vfx-point-quads-native.json`);
const manifest = await read(`${root}/latest-effects/manifest.json`);
if (
  native.definitionSha256 !== (await sha256(metaBytes)) ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Stale native point birth reference");
const mismatches = [],
  omissions = [];
let cases = 0,
  particles = 0,
  lanes = 0,
  streams = 0,
  randomized = 0;
for (const ref of meta.templates) {
  const raw = await bytes(
    `${root}/latest-effects/${manifest.definitions[ref.effectId].file}`,
  );
  if ((await sha256(raw)) !== ref.sourceDefinitionSha256)
    throw Error("Birth source differs");
  const source = JSON.parse(new TextDecoder().decode(raw)).definition
    .complexEmitterDefinitionData[ref.emitterIndex];
  for (const c of native.cases.filter((c) => c.graphSha256 === ref.sha256)) {
    const frame = c.frames[0];
    if (!frame.output.state.births.length) {
      omissions.push({
        effectId: ref.effectId,
        emitterIndex: ref.emitterIndex,
        seedHex: c.seedHex,
        reason: "no-native-birth-at-origin",
      });
      continue;
    }
    const random = kernels.birth.createRandom(BigInt(`0x${c.seedHex}`));
    for (const record of frame.output.state.births) {
      const b = new Float32Array(Uint8Array.fromHex(record.birthHex).buffer);
      const actual = sampleDirectEffectBirth(kernels.birth, source, 0, random);
      for (const [key, at, size] of [
        ["life", 51, 1],
        ["color", 16, 4],
        ["scale", 26, 3],
        ["rotation", 23, 3],
        ["chance", 52, 1],
      ]) {
        const values = Array.isArray(actual[key]) ? actual[key] : [actual[key]];
        for (let lane = 0; lane < size; lane++) {
          if (values[lane] !== b[at + lane])
            mismatches.push({
              effectId: ref.effectId,
              emitterIndex: ref.emitterIndex,
              seedHex: c.seedHex,
              key,
              lane,
              actual: values[lane],
              expected: b[at + lane],
            });
          lanes++;
        }
      }
      particles++;
    }
    const expected = Uint8Array.fromHex(frame.output.state.rngHex);
    const view = new DataView(expected.buffer);
    const state = random.snapshot();
    if (
      state.stateHex !==
        view.getBigUint64(0, true).toString(16).padStart(16, "0") ||
      state.draws !== view.getUint32(8, true)
    )
      mismatches.push({
        effectId: ref.effectId,
        emitterIndex: ref.emitterIndex,
        seedHex: c.seedHex,
        kind: "final-rng-state",
        state,
      });
    if (
      ["particleLifetime", "birthColor", "birthScale0", "birthRotation0"].some(
        (key) =>
          source[key]?.dynamics?.probabilityTables?.some(
            (t) => t.keyTimes?.length,
          ),
      )
    )
      randomized++;
    cases++;
    streams++;
  }
}
for (const file of [
  "latest-direct-effect-birth.mjs",
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
  "latest-vfx-birth.mjs",
  "latest-vfx-values.mjs",
  "tools/inspect-direct-birth.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const result = {
  schema: 1,
  kind: "direct-birth-call-order-native-comparison",
  inputs,
  counts: { cases, particles, lanes, streams, randomized },
  mismatches,
  omissions,
  scope: {
    suppliedSeedsAndOriginClock: true,
    lateBirthClocks: false,
    originalMatchSeedRecovered: false,
    matchCoverage: false,
    gpuSubmission: false,
  },
};
const output = `${cache}/research/direct-birth-native-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: result.counts,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
