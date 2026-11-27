import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../../transport.mjs";
import {
  readCurrentAnimationCueRequest,
  readCurrentChampionAnimationCues,
} from "./native-terrain-animation-cue-reader.mjs";
import {
  createPreparedTerrainByteCodecs,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";
import {
  readCurrentChampionAnimationCatalog,
  readRecordedChampionAnimations,
} from "./recorded-champion-animation-resources.mjs";

const args = process.argv.slice(2);
assert.equal(
  args.length,
  9,
  "Usage: bun verify-current-animation-cues.mjs ROFL BYTE_MAPS SCENE TIMED_CUES CUES_SHA CATALOG CATALOG_SHA NATIVE_READER_RECEIPT RECEIPT_SHA",
);
const [
  rofl,
  byteMaps,
  sceneFile,
  cueFile,
  cuePin,
  catalogFile,
  catalogPin,
  nativeFile,
  nativePin,
] = args;
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const [replayBytes, codecBytes, sceneText, nativeBytes] = await Promise.all([
  readFile(rofl),
  readFile(byteMaps),
  readFile(sceneFile, "utf8"),
  readFile(nativeFile),
]);
const replay = openReplay(Uint8Array.from(replayBytes).buffer);
const scene = JSON.parse(sceneText);
assert.equal(sha256(replayBytes), scene.identity.replaySha256);
assert.equal(sha256(nativeBytes), nativePin);
const native = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(nativeBytes),
);
const decompress = (bytes, target) =>
  zstdDecompressSync(bytes, { maxOutputLength: target.byteLength });
const [terrain, catalog, expected] = await Promise.all([
  createPreparedTerrainByteCodecs(codecBytes, replay, {
    allowCurrentBuild: true,
  }),
  readCurrentChampionAnimationCatalog(catalogFile, catalogPin, scene),
  readRecordedChampionAnimations(cueFile, cuePin, scene, replay, decompress),
]);

const substitution = recoverTerrainByteSubstitution(terrain);
const actors = new Map(
  catalog.bindings.map(({ participantId, model, actions }) => [
    participantId,
    { model, actions: new Map(actions.map((action) => [action.name, action])) },
  ]),
);

let decodedBodies = 0;
for (const row of native) {
  const body = Uint8Array.from(Buffer.from(row.payload, "hex"));
  const actual = readCurrentAnimationCueRequest(body, substitution);
  if (actual === null) continue;
  assert.deepEqual(actual, {
    name: row.name,
    flags: row.callback.flags,
    rate: row.callback.requestFloat,
  });
  assert.equal(row.callback.adjustmentFloatBits, "00000000");
  assert.equal(row.callback.overrideFloatBits, "00000000");
  assert.equal(
    readCurrentAnimationCueRequest(body.subarray(0, -1), substitution),
    null,
  );
  assert.equal(
    readCurrentAnimationCueRequest(Uint8Array.of(...body, 0), substitution),
    null,
  );
  decodedBodies++;
}
assert.ok(decodedBodies > 0);
const cues = readCurrentChampionAnimationCues(
  replay,
  decompress,
  substitution,
  actors,
);
assert.deepEqual(cues, expected.cues);
console.log(
  JSON.stringify({
    replaySha256: scene.identity.replaySha256,
    nativeUniqueBodies: native.length,
    decodedBodies,
    exactCues: cues.length,
    catalogBindings: catalog.bindings.length,
  }),
);
