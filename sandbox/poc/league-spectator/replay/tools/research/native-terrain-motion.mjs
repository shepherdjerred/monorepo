import { movementWorldPaths } from "../../movement-records.mjs";
import { isExactTerrainReplay } from "./native-terrain-byte-codecs.mjs";
import { readNativeTerrainReturnPosition } from "./native-terrain-motion-return.mjs";
import { sampleNativeTerrainMotion } from "./native-terrain-motion-sample.mjs";

function addSnapshots(actors, frames, durationSeconds) {
  let previousTime = -Infinity;
  for (const { timeSeconds, markers } of frames) {
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > durationSeconds ||
      timeSeconds <= previousTime
    )
      throw Error("Invalid champion motion snapshot clock");
    previousTime = timeSeconds;
    for (const { participantId, x, z } of markers) {
      const snapshots = actors.get(participantId)?.track.snapshots;
      if (
        !snapshots ||
        snapshots.at(-1)?.timeSeconds === timeSeconds ||
        !Number.isFinite(x) ||
        !Number.isFinite(z)
      )
        throw Error("Invalid champion motion snapshot position");
      snapshots.push({ timeSeconds, x, z });
    }
  }
}

function collectLifecycle(actors, observations, durationSeconds) {
  const deaths = observations.binding.events.filter(
    ({ kind }) => kind === "champion-death",
  );
  for (const transition of [...deaths, ...observations.returns]) {
    const { context, timeSeconds, kind } = transition;
    const actor = actors.get(context);
    if (
      !actor ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > durationSeconds ||
      (kind !== "champion-death" && kind !== "champion-return")
    )
      throw Error("Invalid verified champion motion lifecycle transition");
    actor.lifecycle.push(transition);
  }
  for (const actor of actors.values()) {
    actor.lifecycle.sort((a, b) => a.timeSeconds - b.timeSeconds);
    let previousTime = -Infinity;
    for (const [index, { kind, timeSeconds }] of actor.lifecycle.entries()) {
      const expectedKind =
        index % 2 === 0 ? "champion-death" : "champion-return";
      if (kind !== expectedKind || timeSeconds <= previousTime)
        throw Error("Verified champion motion lifecycle does not alternate");
      previousTime = timeSeconds;
    }
  }
}

function appendWaypoint(actor, record, opcode, syncId, timeSeconds, origin) {
  const previousSyncId = actor.syncId;
  // Match the signed comparison and rollover rule of the waypoint controller.
  if (
    (previousSyncId | 0) > (syncId | 0) &&
    ((previousSyncId - syncId) | 0) < 0x40000000
  ) {
    actor.coverage.staleWaypoints++;
    return;
  }
  actor.syncId = syncId;
  if (actor.track.events.at(-1)?.kind === "death") {
    actor.coverage.deadWaypoints++;
    return;
  }
  const [{ waypoints }] = movementWorldPaths([record], origin);
  let speed = record.motion?.speed ?? record.speed;
  // The ordinary handler skips a zero header-speed write. The path tick
  // uses the effective movement speed when no positive motion override exists.
  if (opcode === 96 && speed === 0 && waypoints.length > 1) {
    speed = actor.replicatedMoveSpeed ?? speed;
    if (speed > 0) actor.coverage.zeroHeaderPathsUsingMoveSpeed++;
  }
  actor.pathLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const [x, z] = waypoints[i];
    const [previousX, previousZ] = waypoints[i - 1];
    actor.pathLength += Math.hypot(x - previousX, z - previousZ);
  }
  actor.track.events.push({
    kind: "path",
    timeSeconds,
    opcode,
    points: waypoints,
    speeds: [{ timeSeconds, distance: 0, speed }],
  });
  actor.coverage[opcode === 96 ? "ordinaryWaypoints" : "motionWaypoints"]++;
  if (waypoints.length > 1) actor.coverage.multiPointWaypoints++;
}

function applyMoveSpeed(actor, speed, timeSeconds) {
  if (!Number.isFinite(speed) || speed < 0)
    throw Error("Invalid replicated champion move speed");
  actor.coverage.speedWrites++;
  const path = actor.track.events.at(-1);
  if (path?.kind === "death") return;
  actor.replicatedMoveSpeed = speed;
  // Replication writes after an ordinary path affect its remaining distance.
  // Motion-block paths have their own recorded speed.
  if (path?.kind !== "path" || path.opcode !== 96 || path.points.length < 2)
    return;
  const previous = path.speeds.at(-1);
  if (speed === previous.speed) return;
  const distance =
    previous.distance + (timeSeconds - previous.timeSeconds) * previous.speed;
  if (distance >= actor.pathLength) return;
  path.speeds.push({ timeSeconds, distance, speed });
  actor.coverage.appliedSpeedChanges++;
}

function matchLifecycle(actor, packet, kind) {
  const { timeSeconds, secondTimeBits } = packet;
  const event = actor.lifecycle[actor.lifecycleIndex];
  if (
    event?.kind !== kind ||
    event.timeSeconds !== timeSeconds ||
    event.secondTimeBits !== secondTimeBits
  )
    throw Error(
      "Gameplay lifecycle packet disagrees with verified observations",
    );
  actor.lifecycleIndex++;
  if (kind === "champion-death") {
    actor.track.events.push({ kind: "death", timeSeconds });
    actor.replicatedMoveSpeed = null;
    actor.coverage.deaths++;
  } else {
    const position = readNativeTerrainReturnPosition(packet.payload);
    actor.track.events.push({ kind: "return", timeSeconds, ...position });
    actor.track.returns.push({ timeSeconds });
    actor.coverage.returns++;
    if (position !== null) actor.coverage.returnPositions++;
  }
}

/** Index full gameplay evidence once. The browser samples only decoded values. */
export function prepareNativeTerrainMotion(
  prepared,
  keyframes,
  timedPackets,
  { readWaypoints, readMoveSpeed, waypointOrigin, allowCurrentBuild = false },
) {
  const { packetReader, observations } = prepared;
  const { durationSeconds } = packetReader;
  if (
    !isExactTerrainReplay(packetReader, { allowCurrentBuild }) ||
    packetReader.build !== observations.build ||
    packetReader.protocol !== observations.protocol ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Array.isArray(observations.returns) ||
    typeof readWaypoints !== "function" ||
    typeof readMoveSpeed !== "function"
  )
    throw Error(
      "Expected exact-build terrain motion and verified lifecycle inputs",
    );
  movementWorldPaths([], waypointOrigin);
  const structures = new Set(
    [...(observations.turrets ?? []), ...(observations.structures ?? [])].map(
      ({ context }) => context,
    ),
  );
  const actors = new Map();
  const footerRows = new Set();
  for (const { context, footerRow } of observations.binding.verified) {
    if (
      !Number.isInteger(context) ||
      context <= 0 ||
      context > 0xffffffff ||
      !Number.isInteger(footerRow) ||
      footerRow <= 0 ||
      footerRow > observations.roster.length ||
      actors.has(context) ||
      structures.has(context) ||
      footerRows.has(footerRow)
    )
      throw Error("Invalid verified champion motion binding");
    footerRows.add(footerRow);
    actors.set(context, {
      track: { participantId: context, snapshots: [], events: [], returns: [] },
      lifecycle: [],
      lifecycleIndex: 0,
      syncId: 0,
      replicatedMoveSpeed: null,
      coverage: {
        participantId: context,
        footerRow,
        ordinaryWaypoints: 0,
        motionWaypoints: 0,
        multiPointWaypoints: 0,
        staleWaypoints: 0,
        deadWaypoints: 0,
        speedWrites: 0,
        appliedSpeedChanges: 0,
        zeroHeaderPathsUsingMoveSpeed: 0,
        deaths: 0,
        returns: 0,
        returnPositions: 0,
      },
    });
  }
  addSnapshots(actors, keyframes.frames, durationSeconds);
  collectLifecycle(actors, observations, durationSeconds);

  const ids = new Set(actors.keys());
  let opcode = null;
  let context = 0;
  let previousTime = -Infinity;
  for (const packet of timedPackets) {
    if (packet.stream !== 1) continue;
    const { timeSeconds } = packet;
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds < previousTime
    )
      throw Error("Invalid gameplay motion packet clock");
    previousTime = timeSeconds;
    if (timeSeconds > durationSeconds) break;
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 96 || opcode === 1174) {
      const { syncId, records } = readWaypoints(opcode, packet.payload);
      for (const record of records) {
        const actor = actors.get(record.entityId);
        if (actor)
          appendWaypoint(
            actor,
            record,
            opcode,
            syncId,
            timeSeconds,
            waypointOrigin,
          );
      }
    } else if (opcode === 309) {
      for (const { entityId, moveSpeed } of readMoveSpeed(packet.payload, ids)
        .updates)
        applyMoveSpeed(actors.get(entityId), moveSpeed, timeSeconds);
    } else {
      const actor = actors.get(context);
      if (!actor) continue;
      if (opcode === 172 && packet.payload.length === 116)
        matchLifecycle(actor, packet, "champion-death");
      if (opcode === 1098) matchLifecycle(actor, packet, "champion-return");
    }
  }
  const tracks = [];
  const participants = [];
  for (const {
    track,
    lifecycle,
    lifecycleIndex,
    coverage,
  } of actors.values()) {
    if (lifecycleIndex !== lifecycle.length)
      throw Error("Missing gameplay packet for verified champion lifecycle");
    tracks.push(track);
    participants.push({ ...coverage, snapshots: track.snapshots.length });
  }
  const motion = {
    durationSeconds,
    tracks,
    unresolvedParticipants: observations.roster.length - tracks.length,
  };
  const coverage = {
    verifiedParticipants: tracks.length,
    unresolvedParticipants: motion.unresolvedParticipants,
    participantsWithMultiPointPaths: participants.filter(
      ({ multiPointWaypoints }) => multiPointWaypoints > 0,
    ).length,
    participantsWithAppliedSpeedChanges: participants.filter(
      ({ appliedSpeedChanges }) => appliedSpeedChanges > 0,
    ).length,
    keyframes: keyframes.coverage,
    participants,
  };
  return {
    motion,
    coverage,
    sample: (time) => sampleNativeTerrainMotion(motion, time),
  };
}
