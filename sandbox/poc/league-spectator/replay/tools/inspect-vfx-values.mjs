import { resolve } from "node:path";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
const [decoderPath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-values.mjs <decoder> <native-values.json> <evidence.json>",
  );
const root = resolve(decoderPath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  bytes = await Bun.file(`${root}/vfx-values.json`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  native = decode(nativeBytes);
if (
  native.definitionSha256 !== hash(bytes) ||
  hash(bytes) !== profile.vfxValuesSha256 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("VFX value comparison source mismatch");
const values = createLatestVfxValues(decode(bytes)),
  bits = (value) => [
    ...new Uint32Array(
      new Float32Array(Array.isArray(value) ? value : [value]).buffer,
    ),
  ],
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  mismatches = [];
let baseMatches = 0,
  probabilityMatches = 0;
for (const sample of native.cases) {
  const defaultValue = sample.width === 1 ? 0 : [0, 0, 0, 0],
    base = structuredClone(sample.field);
  delete base.dynamics.probabilityTables;
  const actualBase = bits(values.sample(base, sample.time, defaultValue));
  if (same(actualBase, sample.baseBits)) baseMatches++;
  else
    mismatches.push({
      effect: sample.effect,
      path: sample.path,
      time: sample.time,
      kind: "base",
      actual: actualBase,
      expected: sample.baseBits,
    });
  for (const probe of sample.chanceCases) {
    const actual = bits(
      values.sample(sample.field, sample.time, defaultValue, probe.chances),
    );
    if (same(actual, probe.bits)) probabilityMatches++;
    else
      mismatches.push({
        effect: sample.effect,
        path: sample.path,
        time: sample.time,
        kind: "probability-lane-composition",
        actual,
        expected: probe.bits,
      });
  }
}
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  definitionSha256: hash(bytes),
  nativeEvidenceSha256: hash(nativeBytes),
  effectsManifestSha256: native.effectsManifestSha256,
  valueSourceSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-values.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  sampledFields: native.sampledFields,
  availableFields: native.availableFields,
  cases: native.cases.length,
  baseMatches,
  probabilityMatches,
  mismatches,
  scope: native.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    cases: result.cases,
    baseMatches,
    probabilityMatches,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Native/browser VFX value disagreement");
