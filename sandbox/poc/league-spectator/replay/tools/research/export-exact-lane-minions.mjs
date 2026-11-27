import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, sep } from "node:path";
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

const [
  replayPath,
  decoderPath,
  installation,
  staticPath,
  output,
  profile,
  ...extra
] = process.argv.slice(2);
if (
  !replayPath ||
  !decoderPath ||
  !installation ||
  !staticPath ||
  !output ||
  (profile !== undefined &&
    profile !== "--first-wave-8428" &&
    profile !== "--corroborated-waves-8428") ||
  extra.length !== 0
)
  throw Error(
    "Usage: bun export-exact-lane-minions.mjs <saved-rofl> <exact-macos-binary> <league-installation> <terrain-static-json> <output-json> [--first-wave-8428 | --corroborated-waves-8428]",
  );
const firstWave = profile === "--first-wave-8428";
const laterWaves = profile === "--corroborated-waves-8428";
const current = firstWave || laterWaves;
if (current) {
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(output));
  assert.ok(
    parent === cache || parent.startsWith(cache + sep),
    "Current lane evidence must stay in private .cache",
  );
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = digest(new Uint8Array(replayBytes));
const replay = openReplay(replayBytes);
assert.equal(
  replaySha256,
  current
    ? "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
    : "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
);
assert.equal(replay.build, current ? "16.23.841.8428" : "16.23.840.6595");
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
const options = { allowCurrentBuild: current };
const decoder = prepareExactTerrainDecoder(
  await Bun.file(decoderPath).bytes(),
  replay,
  options,
);
const readWaypoints = createWaypointReader(decoder, replay, options);

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
  if (firstWave && packet.timeSeconds >= lastFirstWaveSpawn) continue;
  assert.ok(
    !births.has(packet.context),
    "Expected unique reviewed lane births",
  );
  births.set(packet.context, {
    creation: packet,
    waypoints: new Map(),
    endings: [],
    birthTeamPackets: [],
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
    if (!row || timeSeconds < row.creation.timeSeconds) continue;
    const elapsed = timeSeconds - row.creation.timeSeconds;
    if (laterWaves && row.creation.timeSeconds >= lastFirstWaveSpawn) {
      if (elapsed < 0.09)
        row.birthTeamPackets.push({ timeSeconds, slot: inspect(packet) });
    } else if (row.teamSlot === undefined && elapsed <= 0.035) {
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
  [
    "uv",
    "run",
    "--with",
    "unicorn==2.1.4",
    "python",
    oracle,
    decoderPath,
    ...(current ? [profile] : []),
  ],
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
  current
    ? "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92"
    : undefined,
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
  current
    ? "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d"
    : "338a12c915c8fc2c38a7d5ac9e4ae1e15a1a4ccd0115f2e4f6050e15497ca0f6",
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

function readLaterBirthTeam(packets) {
  const [first, second] = packets;
  if (packets.length <= 1) return first?.slot;
  // These same-clock writes arrive in envelope order. The final recorded
  // team still has to agree with both the barracks and launch-area asset.
  if (
    packets.length === 2 &&
    first.timeSeconds === second.timeSeconds &&
    decoded[first.slot].teamOrdinal === 1 &&
    decoded[second.slot].teamOrdinal === 2
  )
    return second.slot;
  return null;
}

function verifyLife(
  context,
  unitType,
  barracks,
  teamSlot,
  endings,
  removalLimit,
) {
  if (unitType < 4 || unitType > 7) return "unsupportedClass";
  if (teamSlot === undefined) return "missingBirthTeam";
  if (teamSlot === null) return "ambiguousBirthTeam";
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
  // The recorded 117 packet identifies the removed entity. An observed
  // interval outside the cohort's envelope remains an omission.
  const removalDelay = removal.timeSeconds - terminal.timeSeconds;
  if (removalDelay < 4 || removalDelay >= removalLimit)
    return "unverifiedRemovalDelay";
}

for (const [context, row] of births) {
  const { creation, endings, waypoints } = row;
  const creationTimeSeconds = creation.timeSeconds;
  const { entity, unitType, barracks } = decoded[creation.slot];
  const reviewedLaterWave =
    laterWaves && creationTimeSeconds >= lastFirstWaveSpawn;
  const teamSlot = reviewedLaterWave
    ? readLaterBirthTeam(row.birthTeamPackets)
    : row.teamSlot;
  // Current later-wave records corroborate the same explicit terminal and
  // removal pair with observed delays extending from 4.020s to 4.038s.
  const removalLimit = reviewedLaterWave ? 4.04 : 4.02;
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
      : verifyLife(
          context,
          unitType,
          barracks,
          teamSlot,
          endings,
          removalLimit,
        );
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
const encoded = JSON.stringify(report);
if (current) {
  if (firstWave) assert.equal(instances.length, 36);
  await writeFile(output, encoded, { flag: "wx" });
} else {
  await Bun.write(output, encoded);
}
console.log(
  JSON.stringify({
    instances: instances.length,
    paths: instances.reduce((count, row) => count + row.paths.length, 0),
    coverage,
  }),
);
