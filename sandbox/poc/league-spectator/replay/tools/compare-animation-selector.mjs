import path from "node:path";
import { strict as assert } from "node:assert";
import { createLatestVfxValues } from "../latest-vfx-values.mjs";
import { createLatestVfxBirth } from "../latest-vfx-birth.mjs";
import { selectLatestAnimationWeightedPair } from "../latest-animation-selectors.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [decoder, nativePath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun compare-animation-selector.mjs <decoder-directory> <native-observations.json> <comparison.json>",
  );
const nativeBytes = await Bun.file(nativePath).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  profile = await Bun.file(path.join(decoder, "profile.json")).json(),
  birthBytes = await Bun.file(path.join(decoder, "vfx-birth.json")).bytes(),
  valueBytes = await Bun.file(path.join(decoder, "vfx-values.json")).bytes();
assert.equal(await sha256(birthBytes), profile.vfxBirthSha256);
assert.equal(await sha256(valueBytes), profile.vfxValuesSha256);
assert.equal(native.boundary, null);
assert.equal(native.originalMathInitialization.endRva, 0x14aa5f9);
const birth = createLatestVfxBirth(
  JSON.parse(new TextDecoder().decode(birthBytes)),
  createLatestVfxValues(JSON.parse(new TextDecoder().decode(valueBytes))),
);
let samples = 0;
for (const entry of native.cases) {
  const pairs = entry.preparedPairs.map((pair) => ({
    mClipName: `{${pair.key.toString(16).padStart(8, "0")}}`,
    mProbability: pair.probability,
  }));
  let random;
  for (const sample of entry.weightedSelectionSamples) {
    if (sample.draw === 0)
      random = birth.createRandom(BigInt(sample.suppliedHostClockTicks));
    const actual = selectLatestAnimationWeightedPair(pairs, random.next()),
      key = (() => {
        let hash = 2166136261;
        for (const byte of new TextEncoder().encode(actual.toLowerCase()))
          hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        return actual.startsWith("{")
          ? parseInt(actual.slice(1, -1), 16)
          : hash;
      })();
    assert.equal(key, sample.selectedKey);
    const stream = Uint8Array.fromHex(sample.originalStreamHex),
      view = new DataView(stream.buffer),
      state = random.snapshot();
    assert.equal(
      state.stateHex,
      view.getBigUint64(8, true).toString(16).padStart(16, "0"),
    );
    assert.equal(state.draws, view.getUint32(16, true));
    samples++;
  }
}
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-animation-selector-weighted-choice-comparison",
      nativeSha256: await sha256(nativeBytes),
      componentSha256: await sha256(
        await Bun.file(
          new URL("../latest-animation-selectors.mjs", import.meta.url),
        ).bytes(),
      ),
      samples,
      mismatches: [],
      scope:
        "Original weighted selection and RNG state for supplied original host-clock seed controls; global native client activation order is separate",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, samples, mismatches: 0 }));
