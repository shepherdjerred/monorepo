// Compare the browser's typed fields with independently executed native getters.
import { resolve } from "node:path";
import { createLatestFieldReader } from "../latest-fields.mjs";

const [packagePath, observationsPath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-fields.mjs <package-dir> <native-objects.json> <native-getters.json> <evidence.json>",
  );
const root = resolve(packagePath),
  profile = await Bun.file(`${root}/profile.json`).json(),
  codecBytes = await Bun.file(`${root}/field-codecs.json`).arrayBuffer(),
  observationBytes = await Bun.file(observationsPath).arrayBuffer(),
  observations = JSON.parse(new TextDecoder().decode(observationBytes)),
  native = await Bun.file(nativePath).json(),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  hash(codecBytes) !== profile.fieldCodecsSha256 ||
  hash(observationBytes) !== native.observationsSha256 ||
  native.build !== profile.clientVersion ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Missile field comparison package mismatch");
const fields = createLatestFieldReader(
    profile,
    JSON.parse(new TextDecoder().decode(codecBytes)),
  ),
  results = [];
for (const [key, observation] of Object.entries(observations.observations)) {
  const opcode = observation.opcode;
  if (![28, 56, 99, 497, 1027].includes(opcode)) continue;
  if (!native.values[key]) throw Error(`Native getter evidence missing ${key}`);
  const packet = {
      complete: observation.status === "complete",
      object: new Uint8Array(Buffer.from(observation.object, "hex")),
      heap: new Uint8Array(Buffer.from(observation.heap, "hex")),
    },
    decoded =
      opcode === 28
        ? fields.missile(packet)
        : opcode === 1027
          ? fields.cast(packet)
          : fields.missileEvent(packet);
  const actual = Object.fromEntries(
    Object.keys(opcode === 28 ? native.blocks : native.extraBlocks[opcode]).map(
      (name) => [
        name,
        opcode === 28 &&
        [
          "targetPosition",
          "networkId",
          "sourcePosition",
          "sourceFlags",
          "forceRecordedSourcePosition",
          "overrideFlag14d",
          "overrideScalar134",
        ].includes(name)
          ? decoded.cast[name]
          : decoded[name],
      ],
    ),
  );
  if (JSON.stringify(actual) !== JSON.stringify(native.values[key]))
    throw Error(`Native/browser missile field disagreement ${key}`);
  results.push({
    key,
    opcode,
    contextId: opcode === 28 ? decoded.contextId : decoded.entityId,
    ...actual,
  });
}
if (results.length !== Object.keys(native.values).length)
  throw Error("Missile field sample count mismatch");
const evidence = {
  schema: 1,
  build: profile.clientVersion,
  fieldCodecsSha256: profile.fieldCodecsSha256,
  observationsSha256: native.observationsSha256,
  nativeGetterEvidenceSha256: hash(await Bun.file(nativePath).arrayBuffer()),
  matched: results.length,
  mismatches: 0,
  positiveElapsed: results.filter((r) => r.elapsedSeconds > 0).length,
  identityContextsMatched: results.filter(
    (r) => r.opcode === 28 && r.networkId === r.contextId,
  ).length,
  scope:
    "Original getter execution agrees with browser-compatible typed field decoding; no browser UI, trajectory or A/V validation",
  results,
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    matched: evidence.matched,
    mismatches: 0,
    positiveElapsed: evidence.positiveElapsed,
  }),
);
