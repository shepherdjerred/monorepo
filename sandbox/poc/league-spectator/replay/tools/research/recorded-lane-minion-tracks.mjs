import {
  recoverTerrainByteSubstitution,
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";
import { createWaypointReaderFromCodecs } from "./native-terrain-waypoints-reader.mjs";
import { createCurrentLaneMinionPacketReader } from "./recorded-lane-minion-packets.mjs";

const openingWaveBoundary = 36;

function registerGameplay(packets, readPacket, readWaypoints, substitution) {
  const births = new Map();
  const openingTeam = new Map();
  let opcode = null;
  let context = 0;
  for (const packet of packets) {
    if (packet.stream !== 1) continue;
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const { payload, timeSeconds } = packet;
    const birth = births.get(context);
    if (opcode === 189) {
      if (birth !== undefined) throw Error("Repeated lane creation actor");
      births.set(context, {
        creation: readPacket(opcode, payload),
        timeSeconds,
        creationPayload: Uint8Array.from(payload),
        teamPackets: [],
        endings: [],
        waypoints: new Map(),
      });
    } else if (opcode === 66 && payload.length === 2 && payload[0] === 0x77) {
      const index = rotateByteLeft(payload[1], 5) ^ 0xff;
      const team = substitution[swapAdjacentBits(substitution[index] ^ 0x71)];
      if (timeSeconds === 0 && !openingTeam.has(context))
        openingTeam.set(context, team);
      if (birth === undefined || timeSeconds < birth.timeSeconds) continue;
      const elapsed = timeSeconds - birth.timeSeconds;
      if (birth.timeSeconds < openingWaveBoundary) {
        if (birth.teamPackets.length === 0 && elapsed <= 0.035)
          birth.teamPackets.push({ timeSeconds, team });
      } else if (elapsed < 0.09) {
        birth.teamPackets.push({ timeSeconds, team });
      }
    } else if ((opcode === 117 || opcode === 1197) && birth !== undefined) {
      if (timeSeconds > birth.timeSeconds)
        birth.endings.push({
          opcode,
          timeSeconds,
          ...readPacket(opcode, payload),
        });
    } else if (opcode === 96 || opcode === 1174) {
      for (const record of readWaypoints(opcode, payload).records) {
        const actor = births.get(record.entityId);
        if (actor !== undefined && timeSeconds >= actor.timeSeconds)
          actor.waypoints.set(timeSeconds, record);
      }
    }
  }
  return { births, openingTeam };
}

function resolveBirthTeam(packets) {
  if (packets.length <= 1) return packets[0]?.team;
  const [first, second] = packets;
  if (
    packets.length === 2 &&
    first.timeSeconds === second.timeSeconds &&
    first.team === 1 &&
    second.team === 2
  )
    return second.team;
  return null;
}

function verifyLife(context, birth, openingTeam) {
  const { creation, endings } = birth;
  if (creation.entity !== context) return "entityDisagreement";
  if (creation.unitType < 4 || creation.unitType > 7) return "unsupportedClass";
  const team = resolveBirthTeam(birth.teamPackets);
  if (team === undefined) return "missingBirthTeam";
  if (team === null) return "ambiguousBirthTeam";
  const barracksTeam = openingTeam.get(creation.barracks);
  if (barracksTeam === undefined) return "missingBarracksTeam";
  if (team !== 1 && team !== 2) return "unsupportedBirthTeam";
  if (team !== barracksTeam) return "teamDisagreement";
  if (endings.length === 0) return "missingEndings";
  const [terminal, removal] = endings;
  if (
    endings.length !== 2 ||
    terminal.opcode !== 1197 ||
    removal.opcode !== 117 ||
    terminal.relatedEntity === context ||
    removal.entity !== context
  )
    return "unverifiedEndings";
  const removalDelay = removal.timeSeconds - terminal.timeSeconds;
  if (
    removalDelay < 4 ||
    removalDelay >= (birth.timeSeconds < openingWaveBoundary ? 4.02 : 4.04)
  )
    return "unverifiedRemovalDelay";
}

function readPaths(observations, killTimeSeconds, worldPoint) {
  return observations.flatMap(([timeSeconds, record], index) => {
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
}

function readActor(
  context,
  birth,
  openingTeam,
  barracksPlacements,
  worldPoint,
) {
  const reason = verifyLife(context, birth, openingTeam);
  if (reason !== undefined) return { reason };
  const { unitType, barracks } = birth.creation;
  const [
    { timeSeconds: killTimeSeconds },
    { timeSeconds: removalTimeSeconds },
  ] = birth.endings;
  const observations = [...birth.waypoints].filter(
    ([time]) => time >= birth.timeSeconds && time < killTimeSeconds,
  );
  if (observations.length === 0) return { reason: "missingWaypoints" };
  const [launchX, launchZ] = worldPoint(observations[0][1].encodedWaypoints[0]);
  const assets = new Set(
    barracksPlacements.flatMap(({ transform, units }) => {
      const [x, , z] = transform[3];
      return Math.hypot(launchX - x, launchZ - z) < 2100
        ? [units[unitType].asset]
        : [];
    }),
  );
  if (assets.size !== 1) return { reason: "missingLaunchCorroboration" };
  const [asset] = assets;
  const team = resolveBirthTeam(birth.teamPackets) * 100;
  if (!(team === 100 ? /^sru_order/ : /^sru_chaos/).test(asset))
    return { reason: "launchTeamMismatch" };
  const paths = readPaths(observations, killTimeSeconds, worldPoint);
  if (paths.length === 0) return { reason: "missingBoundedMotion" };
  return {
    actor: {
      context,
      modelId: asset.split("/")[0],
      team,
      unitType,
      barracksContext: barracks,
      creationTimeSeconds: birth.timeSeconds,
      killTimeSeconds,
      removalTimeSeconds,
      creationPayload: birth.creationPayload,
      paths,
    },
  };
}

/** Recover only lane actors with original creation, team, end and movement evidence. */
export function readCurrentLaneMinionTracks({
  replay,
  packets,
  codecs,
  movementOrigin,
  barracksPlacements,
}) {
  if (
    barracksPlacements.length !== 6 ||
    movementOrigin.length !== 2 ||
    !movementOrigin.every(Number.isFinite)
  )
    throw Error(
      "Recorded lane paths require authenticated Map11 barracks and movement origin",
    );
  const { births, openingTeam } = registerGameplay(
    packets,
    createCurrentLaneMinionPacketReader(replay, codecs),
    createWaypointReaderFromCodecs(codecs),
    recoverTerrainByteSubstitution(codecs),
  );
  const worldPoint = (point) =>
    point.map((coordinate, axis) => 2 * coordinate + movementOrigin[axis]);
  const instances = [];
  const coverage = {
    candidateBirths: births.size,
    birthsByClass: {},
    admittedByModel: {},
    omissions: {},
  };
  const count = (table, key) => {
    table[key] = (table[key] ?? 0) + 1;
  };
  for (const [context, birth] of births) {
    count(coverage.birthsByClass, birth.creation.unitType);
    const { actor, reason } = readActor(
      context,
      birth,
      openingTeam,
      barracksPlacements,
      worldPoint,
    );
    if (actor === undefined) {
      if (birth.timeSeconds < openingWaveBoundary)
        throw Error(`First-wave lane birth failed corroboration: ${reason}`);
      count(coverage.omissions, reason);
    } else {
      instances.push(actor);
      count(coverage.admittedByModel, actor.modelId);
    }
  }
  return { instances, coverage };
}
