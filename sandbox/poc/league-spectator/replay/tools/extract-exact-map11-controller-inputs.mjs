import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";

import {
  createMap11ControllerPacketCollector,
  deriveCurrentMap11ControllerVisibility,
} from "./research/native-terrain-controller-visibility.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const long = "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
const short =
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
/** Exact authored Map11 controller graph and geometry cohort, reusable across replays. */
export function readExactMap11ControllerGraph(map, materials) {
  const geometrySha256 = sha(map);
  const allowedExports = new Map([
    ["24716f3c47ed5eadaa80693f0113dffb21dd2b5ab419957c5ae91c3a0e77ad15", 12],
    ["4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d", 13],
    ["5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc", 13],
  ]);
  assert.ok(allowedExports.has(geometrySha256));
  const materialsSha256 = sha(materials);
  assert.equal(
    materialsSha256,
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  );
  const meshControllerIds = [
    ...new Set(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(map))
        .meshes.map((mesh) => mesh.controller)
        .filter(Boolean),
    ),
  ].sort((a, b) => a - b);
  assert.equal(meshControllerIds.length, allowedExports.get(geometrySha256));

  const directClasses = new Set(["c406a533", "ec733fe2", "e07edfa4"]);
  const { objects } = readExactMapBin(materials);
  const controllers = {};
  for (const { pathHash, classHash, fields } of objects) {
    const id = Number.parseInt(pathHash, 16);
    if (directClasses.has(classHash)) {
      const name = fields[mapBinHash("Name")];
      assert.equal(name.type, "Hash");
      const authored = fields[mapBinHash("DefaultVisible")];
      assert.ok(authored === undefined || authored.type === "Bool");
      controllers[id] = {
        classHash,
        nameHash: name.value,
        defaultVisible: authored?.value ?? null,
        elementalTerrainFlags:
          fields[mapBinHash("ElementalTerrainFlags")]?.value ?? null,
      };
    } else if (classHash === "e21083b5") {
      const children = fields["3044938a"].elements.map((field) => {
        assert.equal(field.type, "ObjectLink");
        return field.value;
      });
      controllers[id] = {
        classHash,
        children,
        operation: fields["c9d3f06a"]?.value ?? null,
      };
    }
  }
  return { geometrySha256, materialsSha256, meshControllerIds, controllers };
}
export function readExactMap11ControllerPackets(replay) {
  const collector = createMap11ControllerPacketCollector();
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, (input, out) =>
      zstdDecompressSync(input, { maxOutputLength: out.byteLength }),
    ),
  ))
    collector.observe(packet);
  return collector.finish();
}
/** Use prepared exact-build codecs and local assets to derive terrain without a per-match receipt. */
export function deriveExactCurrentMap11TerrainVisibility(
  replay,
  map,
  materials,
  codecs,
) {
  const graph = readExactMap11ControllerGraph(map, materials);
  const { geometrySha256, materialsSha256 } = graph;
  return deriveCurrentMap11ControllerVisibility({
    ...graph,
    ...readExactMap11ControllerPackets(replay),
    identity: {
      replaySha256: sha(replay.bytes),
      build: replay.build,
      protocol: replay.protocol,
      geometrySha256,
      materialsSha256,
    },
    codecs,
    durationSeconds: replay.duration,
  });
}

if (import.meta.main) {
  const [replayPath, geometryMetadata, materialBin, output, mode] =
    process.argv.slice(2);
  if (
    !replayPath ||
    !geometryMetadata ||
    !materialBin ||
    !output ||
    (mode !== undefined &&
      mode !== "--same-build" &&
      mode !== "--exact-8428" &&
      mode !== "--compare-8428-packets") ||
    process.argv.length > 7
  )
    throw Error(
      "Usage: bun extract-exact-map11-controller-inputs.mjs <saved-rofl> <map.json> <base_srx.materials.bin> <new-input.json> [--same-build | --exact-8428 | --compare-8428-packets]",
    );
  const comparePackets = mode === "--compare-8428-packets";
  const bytes = readFileSync(replayPath);
  const replaySha256 = sha(bytes);
  if (mode === undefined) assert.ok([short, long].includes(replaySha256));
  const replay = openReplay(Uint8Array.from(bytes).buffer);
  assert.equal(
    replay.build,
    comparePackets || mode === "--exact-8428"
      ? "16.23.841.8428"
      : "16.23.840.6595",
  );
  assert.equal(replay.protocol, "8bbfcd5af2bc92db");
  const { geometrySha256, materialsSha256, meshControllerIds, controllers } =
    readExactMap11ControllerGraph(
      readFileSync(geometryMetadata),
      readFileSync(materialBin),
    );
  const { packets: recorded, snapshotChunks } =
    readExactMap11ControllerPackets(replay);
  const packets = recorded.map(({ payload, ...row }) => ({
    ...row,
    payloadHex: Buffer.from(payload).toString("hex"),
  }));
  if (mode === undefined)
    assert.equal(packets.length, replaySha256 === long ? 530 : 32);
  writeFileSync(
    output === "-" ? 1 : output,
    JSON.stringify(
      {
        replaySha256,
        build: replay.build,
        protocol: replay.protocol,
        geometrySha256,
        materialsSha256,
        meshControllerIds,
        controllers,
        packets,
        ...(mode === undefined ? {} : { snapshotChunks: [...snapshotChunks] }),
        ...(comparePackets ? { comparisonOnly: true } : {}),
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
}
