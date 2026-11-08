import { resolve } from "node:path";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import { createLatestVfxEmission } from "../latest-vfx-emission.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-emission.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  packageBytes = await Bun.file(`${root}/vfx-emission.json`).arrayBuffer(),
  valueBytes = await Bun.file(`${root}/vfx-values.json`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  native = decode(nativeBytes);
if (
  hash(packageBytes) !== profile.vfxEmissionSha256 ||
  hash(valueBytes) !== profile.vfxValuesSha256 ||
  native.definitionSha256 !== profile.vfxEmissionSha256 ||
  native.vfxValuesSha256 !== profile.vfxValuesSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest
)
  throw Error("VFX emission comparison source mismatch");
const emission = createLatestVfxEmission(
    decode(packageBytes),
    createLatestVfxValues(decode(valueBytes)),
  ),
  mismatches = [];
let matches = 0,
  sequenceFrames = 0;
for (const sample of native.cases) {
  const actual = emission.count(sample.emitter, sample.input).count;
  if (actual === sample.count) matches++;
  else mismatches.push({ ...sample, actual });
}
const sequenceSummaries = [],
  bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0];
for (const sequence of native.sequences) {
  const state = { lastEmissionTime: 0, hasEmitted: false };
  let particles = 0,
    births = 0;
  for (const frame of sequence.frames) {
    const actual = emission.count(sequence.emitter, {
      ...state,
      time: frame.time,
      normalizedAge: frame.normalizedAge,
      qualityScale: 1,
    });
    if (actual.count) {
      emission.commitBirth(state, frame.time);
      particles += actual.count;
      births++;
    }
    if (
      actual.count !== frame.count ||
      bits(state.lastEmissionTime) !== frame.lastEmissionTimeBits ||
      state.hasEmitted !== frame.hasEmitted
    )
      mismatches.push({
        kind: "count-commit-sequence",
        emitter: sequence.emitter,
        cadence: sequence.cadence,
        frame,
        actual,
        state: { ...state },
      });
    sequenceFrames++;
  }
  sequenceSummaries.push({
    emitter: sequence.emitter,
    cadence: sequence.cadence,
    frames: sequence.frames.length,
    particles,
    birthUpdates: births,
  });
}
let birthOrigins = 0;
for (const sample of native.positionCases) {
  const actual = emission
    .birthOrigins(sample.previous, sample.current, sample.requestedCount)
    .map((p) => p.map(bits));
  if (JSON.stringify(actual) !== JSON.stringify(sample.positionsBits))
    mismatches.push({
      kind: "birth-origins",
      previous: sample.previous,
      current: sample.current,
      requestedCount: sample.requestedCount,
      actual,
      expected: sample.positionsBits,
    });
  birthOrigins += actual.length;
}
const sources = Object.fromEntries(
  await Promise.all(
    ["latest-vfx-values.mjs", "latest-vfx-emission.mjs"].map(async (name) => [
      name,
      hash(
        await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
      ),
    ]),
  ),
);
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(packageBytes),
  vfxValuesSha256: hash(valueBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  observerSourceSha256: native.observerSourceSha256,
  effectsManifestSha256: native.effectsManifestSha256,
  sources,
  availableEmitterFields: native.availableEmitterFields,
  sampledEmitterFields: native.sampledEmitterFields,
  omitted: native.omitted,
  cases: native.cases.length,
  matches,
  sequences: sequenceSummaries,
  sequenceFrames,
  positionCases: native.positionCases.length,
  birthOrigins,
  mismatches,
  sequenceScope: native.sequenceScope,
  positionScope: native.positionScope,
  scope: native.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    cases: native.cases.length,
    matches,
    sequences: sequenceSummaries.length,
    sequenceFrames,
    positionCases: native.positionCases.length,
    birthOrigins,
    mismatches: mismatches.length,
    firstMismatch: mismatches[0],
  }),
);
if (mismatches.length) process.exitCode = 1;
