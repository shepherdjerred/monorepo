import { resolve } from "node:path";
import { createLatestVfxBirth } from "../latest-vfx-birth.mjs";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";

const [packagePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-birth.mjs <decoder> <native-evidence> <comparison>",
  );
const root = resolve(packagePath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  packageBytes = await Bun.file(`${root}/vfx-birth.json`).arrayBuffer(),
  valueBytes = await Bun.file(`${root}/vfx-values.json`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  native = decode(nativeBytes),
  bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0];
if (
  hash(packageBytes) !== profile.vfxBirthSha256 ||
  native.definitionSha256 !== profile.vfxBirthSha256 ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  hash(valueBytes) !== profile.vfxValuesSha256 ||
  decode(packageBytes).vfxValuesSha256 !== profile.vfxValuesSha256 ||
  native.vfxValuesSha256 !== profile.vfxValuesSha256
)
  throw Error("VFX birth comparison source mismatch");
const birth = createLatestVfxBirth(
    decode(packageBytes),
    createLatestVfxValues(decode(valueBytes)),
  ),
  mismatches = [];
let randomDraws = 0,
  checkpointDraws = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const sequence of native.randomSequences) {
  const random = birth.createRandom(BigInt(`0x${sequence.seedHex}`));
  for (const [index, frame] of sequence.frames.entries()) {
    if (index === 1 && sequence.counterOverrideAfterFirst !== null)
      random.restore({
        ...random.snapshot(),
        draws: sequence.counterOverrideAfterFirst,
      });
    const actual = { floatBits: bits(random.next()), ...random.snapshot() };
    if (!same(actual, frame))
      mismatches.push({
        kind: "random",
        seed: sequence.seedHex,
        index,
        actual,
        expected: frame,
      });
    randomDraws++;
  }
  const checkpoint = sequence.frames[19];
  random.restore({ stateHex: checkpoint.stateHex, draws: checkpoint.draws });
  for (const [index, frame] of sequence.frames.slice(20, 52).entries()) {
    const actual = { floatBits: bits(random.next()), ...random.snapshot() };
    if (!same(actual, frame))
      mismatches.push({
        kind: "checkpoint",
        seed: sequence.seedHex,
        index,
        actual,
        expected: frame,
      });
    checkpointDraws++;
  }
}
for (const sample of native.conversions) {
  const actual = bits(birth.floatFromLowWord(sample.lowWord));
  if (actual !== sample.floatBits)
    mismatches.push({ kind: "float-conversion", ...sample, actual });
}
for (const sample of native.pointCases) {
  const actual = birth.pointOffset(sample.shape).map(bits);
  if (!same(actual, sample.offsetBits) || !sample.otherBytesUnchanged)
    mismatches.push({ kind: "point-offset", ...sample, actual });
}
let valueSamples = 0,
  valueRandomDraws = 0;
for (const field of native.valueCases) {
  const random = birth.createRandom(1n),
    defaultValue = field.width === 1 ? 0 : Array(field.width).fill(0);
  for (const sample of field.samples) {
    random.restore(sample.randomBefore);
    const output = birth.sampleValue(
        field.field,
        sample.time,
        defaultValue,
        random,
        sample.sharedChance,
      ),
      actual = (Array.isArray(output) ? output : [output]).map(bits),
      after = random.snapshot();
    if (!same(actual, sample.valueBits) || !same(after, sample.randomAfter))
      mismatches.push({
        kind: "randomized-value",
        effect: field.effect,
        path: field.path,
        time: sample.time,
        sharedChance: sample.sharedChance,
        actual,
        expected: sample.valueBits,
        randomActual: after,
        randomExpected: sample.randomAfter,
      });
    valueSamples++;
    valueRandomDraws +=
      (sample.randomAfter.draws - sample.randomBefore.draws) >>> 0;
  }
}
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(packageBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  effectsManifestSha256: native.effectsManifestSha256,
  observerSourceSha256: native.observerSourceSha256,
  birthSourceSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-birth.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  sequences: native.randomSequences.length,
  randomDraws,
  checkpointDraws,
  conversions: native.conversions.length,
  authoredPoints: native.authoredPoints,
  pointCases: native.pointCases.length,
  valueFields: native.valueCases.length,
  valueSamples,
  valueRandomDraws,
  fieldGroups: native.fieldGroups,
  valueScope: native.valueScope,
  valueSourceSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-values.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  mismatches,
  adapters: native.adapters,
  scope: native.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    randomDraws,
    checkpointDraws,
    pointCases: native.pointCases.length,
    valueSamples,
    valueRandomDraws,
    mismatches: mismatches.length,
    firstMismatch: mismatches[0],
  }),
);
if (mismatches.length) process.exitCode = 1;
