import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import {
  bindMap11BarracksDefinitions,
  readMap11PlaceableInventory,
} from "../map11-world-catalog.mjs";
import { openLocalWad } from "../wad.mjs";
import { prepareExactTerrainDecoder } from "./native-terrain-positions-944.mjs";
import { createWaypointReader } from "./native-terrain-waypoints.mjs";

const [replayPath, decoderPath, installation, staticPath, output] =
  process.argv.slice(2);
if (!replayPath || !decoderPath || !installation || !staticPath || !output)
  throw Error(
    "Usage: bun export-exact-lane-minions.mjs <saved-rofl> <exact-macos-binary> <league-installation> <terrain-static-json> <output-json>",
  );

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = digest(new Uint8Array(replayBytes));
const replay = openReplay(replayBytes);
assert.equal(
  replaySha256,
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
);
assert.equal(replay.build, "16.23.840.6595");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
const decoder = prepareExactTerrainDecoder(await Bun.file(decoderPath).bytes());
const readWaypoints = createWaypointReader(decoder, replay);

function* gameplayPackets() {
  let opcode = null;
  let context = 0;
  const inflate = (input, target) =>
    zstdDecompressSync(input, { maxOutputLength: target.byteLength });
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, inflate),
  )) {
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (packet.stream === 1) yield { ...packet, opcode, context };
  }
}

const births = new Map();
const lastFirstWaveSpawn = 36;
for (const packet of gameplayPackets()) {
  if (packet.opcode !== 189) continue;
  assert.ok(
    !births.has(packet.context),
    "Expected unique reviewed lane births",
  );
  births.set(packet.context, {
    creation: packet,
    waypoints: new Map(),
    endings: [],
  });
}
assert.equal(
  [...births.values()].filter(
    ({ creation }) => creation.timeSeconds < lastFirstWaveSpawn,
  ).length,
  36,
);

const requests = [];
function inspect(packet) {
  const slot = requests.length;
  requests.push([
    packet.opcode,
    packet.context,
    Buffer.from(packet.payload).toString("hex"),
  ]);
  return slot;
}

const openingTeamSlots = new Map();
for (const { creation } of births.values()) creation.slot = inspect(creation);
for (const packet of gameplayPackets()) {
  const { opcode, context, timeSeconds, payload } = packet;
  if (opcode === 66 && payload.length === 2 && payload[0] === 0x77) {
    if (timeSeconds === 0 && !openingTeamSlots.has(context)) {
      openingTeamSlots.set(context, inspect(packet));
    }
    const row = births.get(context);
    if (
      row &&
      row.teamSlot === undefined &&
      timeSeconds >= row.creation.timeSeconds &&
      timeSeconds - row.creation.timeSeconds <= 0.035
    ) {
      row.teamSlot = inspect(packet);
    }
  } else if (opcode === 1197 || opcode === 117) {
    const row = births.get(context);
    if (row && timeSeconds > row.creation.timeSeconds)
      row.endings.push({ opcode, timeSeconds, slot: inspect(packet) });
  } else if (opcode === 96 || opcode === 1174) {
    for (const record of readWaypoints(opcode, payload).records) {
      const row = births.get(record.entityId);
      if (row && timeSeconds >= row.creation.timeSeconds)
        row.waypoints.set(timeSeconds, record);
    }
  }
}

const oracle = fileURLToPath(
  new URL("./exact-lane-minion-reader.py", import.meta.url),
);
const native = Bun.spawnSync(
  ["uv", "run", "--with", "unicorn==2.1.4", "python", oracle, decoderPath],
  {
    stdin: Buffer.from(JSON.stringify(requests)),
    stdout: "pipe",
    stderr: "inherit",
  },
);
assert.equal(native.exitCode, 0, "Exact structural lane reader failed");
const {
  decoded,
  decoderSha256: nativeReaderSha256,
  creationTableSha256,
} = JSON.parse(native.stdout.toString());
assert.equal(decoded.length, requests.length);

const wad = await openLocalWad(
  installation,
  "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  Bun.zstdDecompressSync,
);
const materials = readExactMapBin(
  await wad("data/maps/mapgeometry/map11/base_srx.materials.bin"),
);
const definitions = readExactMapBin(
  await wad("data/maps/shipping/map11/map11.bin"),
);
assert.equal(
  materials.sourceSha256,
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
);
assert.equal(
  definitions.sourceSha256,
  "338a12c915c8fc2c38a7d5ac9e4ae1e15a1a4ccd0115f2e4f6050e15497ca0f6",
);
const catalog = bindMap11BarracksDefinitions(
  readMap11PlaceableInventory(materials, "09e8f830"),
  definitions,
);
const barracksPlacements = catalog.registration.filter(
  (entry) => entry.kind === "barracks",
);
assert.equal(barracksPlacements.length, 6);
const { movementOrigin } = (await Bun.file(staticPath).json()).find(
  (entry) => entry.grid,
).grid;
assert.deepEqual(movementOrigin, [7358, 7412]);
const worldPoint = (point) =>
  point.map((coordinate, axis) => 2 * coordinate + movementOrigin[axis]);

const instances = [];
const omissions = {};
const birthsByClass = {};
const admittedByModel = {};

function verifyLife(context, unitType, barracks, teamSlot, endings) {
  if (unitType < 4 || unitType > 7) return "unsupportedClass";
  if (teamSlot === undefined) return "missingBirthTeam";
  const parentSlot = openingTeamSlots.get(barracks);
  if (parentSlot === undefined) return "missingBarracksTeam";
  const { teamOrdinal } = decoded[teamSlot];
  if (teamOrdinal !== 1 && teamOrdinal !== 2) return "unsupportedBirthTeam";
  if (teamOrdinal !== decoded[parentSlot].teamOrdinal)
    return "teamDisagreement";
  const [terminal, removal] = endings;
  if (endings.length === 0) return "missingEndings";
  if (
    endings.length !== 2 ||
    terminal.opcode !== 1197 ||
    removal.opcode !== 117 ||
    decoded[terminal.slot].relatedEntity === context ||
    decoded[removal.slot].entity !== context
  )
    return "unverifiedEndings";
  // Keep the removal window established by the reviewed first wave. A late
  // candidate outside that window requires separate lifecycle corroboration.
  const removalDelay = removal.timeSeconds - terminal.timeSeconds;
  if (removalDelay < 4 || removalDelay >= 4.02) return "unverifiedRemovalDelay";
}

for (const [context, { creation, teamSlot, endings, waypoints }] of births) {
  const creationTimeSeconds = creation.timeSeconds;
  const { entity, unitType, barracks } = decoded[creation.slot];
  birthsByClass[unitType] = (birthsByClass[unitType] ?? 0) + 1;
  const omit = (reason) => {
    assert.ok(
      creationTimeSeconds >= lastFirstWaveSpawn,
      `First-wave lane birth ${context} failed corroboration: ${reason}`,
    );
    omissions[reason] = (omissions[reason] ?? 0) + 1;
  };
  const omission =
    entity !== context
      ? "entityDisagreement"
      : verifyLife(context, unitType, barracks, teamSlot, endings);
  if (omission) {
    omit(omission);
    continue;
  }
  const team = decoded[teamSlot].teamOrdinal * 100;
  const [terminal, removal] = endings;
  // Suppress live paths at the death-family packet and retain the later
  // decoded 117 timestamp separately. Corpse presentation is outside scope.
  const killTimeSeconds = terminal.timeSeconds;
  const removalTimeSeconds = removal.timeSeconds;

  const observations = [...waypoints].filter(
    ([time]) => time >= creationTimeSeconds && time < killTimeSeconds,
  );
  if (!observations.length) {
    omit("missingWaypoints");
    continue;
  }
  const [launchX, launchZ] = worldPoint(observations[0][1].encodedWaypoints[0]);
  // This corroborates the team-owned config. It does not bind an individual
  // authored lane when two barracks on the same team are in launch range.
  const localAppearances = new Set(
    barracksPlacements
      .filter(({ transform }) => {
        const [x, , z] = transform[3];
        return Math.hypot(launchX - x, launchZ - z) < 2100;
      })
      .map(({ units }) => units[unitType].asset),
  );
  if (localAppearances.size !== 1) {
    omit("missingLaunchCorroboration");
    continue;
  }
  const [asset] = localAppearances;
  if (!(team === 100 ? /^sru_order/ : /^sru_chaos/).test(asset)) {
    omit("launchTeamMismatch");
    continue;
  }
  const [modelId, skinId] = asset.split("/");
  assert.ok(wad.has(`data/characters/${modelId}/skins/skin${skinId}.bin`));

  const paths = observations.flatMap(([timeSeconds, record], index) => {
    const speed = record.motion?.speed ?? record.speed;
    if (!(speed > 0) || record.encodedWaypoints.length < 2) return [];
    const points = record.encodedWaypoints.map(worldPoint);
    const distance = points.slice(1).reduce((length, [x, z], pointIndex) => {
      const [priorX, priorZ] = points[pointIndex];
      return length + Math.hypot(x - priorX, z - priorZ);
    }, 0);
    if (distance === 0) return [];
    const endTimeSeconds = Math.min(
      timeSeconds + distance / speed,
      observations[index + 1]?.[0] ?? killTimeSeconds,
    );
    return [
      {
        timeSeconds,
        endTimeSeconds,
        points,
        speeds: [{ timeSeconds, speed, distance: 0 }],
      },
    ];
  });
  if (!paths.length) {
    omit("missingBoundedMotion");
    continue;
  }
  instances.push({
    context,
    modelId,
    team,
    unitType,
    barracksContext: barracks,
    creationTimeSeconds,
    killTimeSeconds,
    removalTimeSeconds,
    creationPayloadSha256: digest(creation.payload),
    paths,
  });
  admittedByModel[modelId] = (admittedByModel[modelId] ?? 0) + 1;
}

const coverage = {
  candidateBirths: births.size,
  birthsByClass,
  admittedByModel,
  omissions,
};
const report = {
  decoderSha256: digest(decoder),
  nativeReaderSha256,
  creationTableSha256,
  materialsSha256: materials.sourceSha256,
  mapBinSha256: definitions.sourceSha256,
  kind: "exact-terrain-lane-minion-waypoint-evidence",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  instances,
  coverage,
};
await Bun.write(output, JSON.stringify(report));
console.log(
  JSON.stringify({
    instances: instances.length,
    paths: instances.reduce((count, row) => count + row.paths.length, 0),
    coverage,
  }),
);
