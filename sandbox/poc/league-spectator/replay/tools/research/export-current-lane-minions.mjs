import assert from "node:assert/strict";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import {
  bindMap11BarracksDefinitions,
  readMap11PlaceableInventory,
} from "../map11-world-catalog.mjs";
import { currentTerrainClientArchiveSha256 } from "./native-terrain-byte-codecs.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { readCurrentLaneMinionTracks } from "./recorded-lane-minion-tracks.mjs";
import { verifyCanonicalRecordedRift } from "./verify-canonical-rift-replay.mjs";

const [
  replayPath,
  canonicalPath,
  canonicalDigest,
  decoderPath,
  materialsPath,
  definitionsPath,
  output,
  ...extra
] = process.argv.slice(2);
if (
  output === undefined ||
  extra.length ||
  !/^[a-f0-9]{64}$/.test(canonicalDigest)
)
  throw Error(
    "Usage: bun export-current-lane-minions.mjs <saved-rofl> <canonical Match-V5 JSON> <canonical SHA-256> <prepared decoder> <Map11 materials BIN> <Map11 definitions BIN> <new private output JSON>",
  );
const cache = await realpath(".cache");
const parent = await realpath(dirname(output));
assert.ok(
  parent === cache || parent.startsWith(cache + sep),
  "Lane evidence must stay in private .cache",
);

const digest = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const replay = openReplay(await Bun.file(replayPath).arrayBuffer());
await verifyCanonicalRecordedRift(
  canonicalPath,
  canonicalDigest,
  replayPath,
  replay,
);
const decoder = await Bun.file(decoderPath).bytes();
const codecs = createExactTerrainByteCodecs(decoder, replay, {
  allowCurrentBuild: true,
});
const materials = readExactMapBin(await Bun.file(materialsPath).bytes());
const definitions = readExactMapBin(await Bun.file(definitionsPath).bytes());
assert.equal(
  materials.sourceSha256,
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
);
assert.equal(
  definitions.sourceSha256,
  "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d",
);
const { registration } = bindMap11BarracksDefinitions(
  readMap11PlaceableInventory(materials, "09e8f830"),
  definitions,
);
const barracksPlacements = registration.filter(
  ({ kind }) => kind === "barracks",
);
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const { instances, coverage } = readCurrentLaneMinionTracks({
  replay,
  packets: replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, inflate)),
  codecs,
  movementOrigin: [7358, 7412],
  barracksPlacements,
});
const report = {
  decoderSha256: digest(decoder),
  nativeReaderSha256: currentTerrainClientArchiveSha256,
  creationTableSha256:
    "328528d693ab5d96a815b6706694025a980e609019304aeb2e5e32797011c04b",
  materialsSha256: materials.sourceSha256,
  mapBinSha256: definitions.sourceSha256,
  kind: "exact-terrain-lane-minion-waypoint-evidence",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: digest(replay.bytes),
  instances: instances.map(({ creationPayload, paths, ...actor }) => ({
    ...actor,
    creationPayloadSha256: digest(creationPayload),
    paths,
  })),
  coverage,
};
await writeFile(output, JSON.stringify(report), { flag: "wx" });
console.log(
  JSON.stringify({
    actors: instances.length,
    paths: instances.reduce((count, actor) => count + actor.paths.length, 0),
    coverage,
  }),
);
