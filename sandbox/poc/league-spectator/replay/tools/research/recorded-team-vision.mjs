import {
  assertExactTerrainReplay,
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";

function readTeamSlot(payload, substitution) {
  if (payload.length !== 2 || (payload[0] & 1) === 0)
    throw Error("Unsupported recorded team vision mask framing");
  // Original 66/696 body readers share the bit permutation and substitution.
  const mapped = substitution[rotateByteLeft(payload[1], 5) ^ 0xff];
  const slot = substitution[swapAdjacentBits(mapped ^ 0x71)];
  if (slot !== 1 && slot !== 2)
    throw Error("Recorded mask does not select a Map11 spectator team");
  return slot;
}

function recordMask(changes, timeSeconds, mask) {
  const previous = changes.at(-1);
  if (previous && previous[0] > timeSeconds)
    throw Error("Recorded team vision has an out-of-order transition");
  if (previous?.[0] === timeSeconds) changes.pop();
  if (changes.at(-1)?.[1] !== mask) changes.push([timeSeconds, mask]);
}

function registerActors(participants, worldActors, durationSeconds) {
  const actors = new Map();
  const add = (context, creationTimeSeconds, teamId, candidate = false) => {
    if (
      !Number.isSafeInteger(context) ||
      context <= 0 ||
      context > 0xffffffff ||
      actors.has(context) ||
      !Number.isFinite(creationTimeSeconds) ||
      creationTimeSeconds < 0 ||
      creationTimeSeconds > durationSeconds
    )
      throw Error("Invalid recorded team vision actor binding");
    actors.set(context, {
      creationTimeSeconds,
      teamId,
      candidate,
      mask: 0,
      initialized: false,
      changes: [],
    });
  };
  for (const { participantId, teamId } of participants) {
    if (teamId !== 100 && teamId !== 200)
      throw Error("Recorded team vision champion has no exact team");
    add(participantId, 0, teamId);
  }
  for (const [context, creationTimeSeconds] of worldActors)
    add(context, creationTimeSeconds);
  return { actors, add };
}

/** Continuous mode-3 masks from opening state and original gameplay packet order. */
export function createCurrentRecordedTeamVisionCollector(
  replay,
  participants,
  worldActors,
  codecs,
  { dynamicActors = false } = {},
) {
  assertExactTerrainReplay(replay, { allowCurrentBuild: true });
  if (replay.build !== currentTerrainPositionBuild)
    throw Error("Replay-derived team vision requires the exact .8428 build");
  const durationSeconds = replay.durationMilliseconds / 1000;
  const { actors, add } = registerActors(
    participants,
    worldActors,
    durationSeconds,
  );
  if (actors.size === 0) throw Error("Recorded team vision has no actors");
  const substitution = recoverTerrainByteSubstitution(codecs);
  let openingChunk;
  let opcode = null;
  let context = 0;
  let pendingTime;
  const pending = new Map();
  function apply(actor, opcode, payload, timeSeconds) {
    if (!Number.isFinite(timeSeconds) || timeSeconds > durationSeconds)
      throw Error("Recorded team vision packet is outside the replay clock");
    if (opcode === 1012) {
      if (actor.initialized) return;
      actor.initialized = true;
    } else {
      const bit = 1 << readTeamSlot(payload, substitution);
      actor.mask = opcode === 66 ? actor.mask | bit : actor.mask & ~bit;
    }
    // The original mode-3 reset leaves the initialization flag and mask intact.
    if (actor.initialized) recordMask(actor.changes, timeSeconds, actor.mask);
  }
  function observe(packet) {
    const { chunkOffset, blockOffset, stream, timeSeconds, payload } = packet;
    if (blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (stream === 2) openingChunk ??= chunkOffset;
    if (stream !== 1 && (stream !== 2 || openingChunk !== chunkOffset)) return;
    if (dynamicActors && stream === 1 && timeSeconds !== pendingTime) {
      pending.clear();
      pendingTime = timeSeconds;
    }
    if (opcode !== 1012 && opcode !== 66 && opcode !== 696) return;
    const actor = actors.get(context);
    if (actor === undefined) {
      if (dynamicActors && stream === 1) {
        const sameClockPackets = pending.get(context) ?? [];
        sameClockPackets.push({ opcode, payload });
        pending.set(context, sameClockPackets);
      }
      return;
    }
    if (timeSeconds >= actor.creationTimeSeconds)
      apply(actor, opcode, payload, timeSeconds);
  }
  function finish(admittedCandidates) {
    const admitted = [...actors].filter(
      ([context, { candidate }]) =>
        !candidate || admittedCandidates?.has(context),
    );
    return admitted.map(([context, { changes, teamId }]) => {
      if (changes.length === 0)
        throw Error("Recorded vision is missing a rendered actor");
      if (teamId !== undefined) {
        const ownTeamBit = teamId === 100 ? 2 : 4;
        if (
          changes[0][0] !== 0 ||
          changes.some(([, mask]) => (mask & ownTeamBit) === 0)
        )
          throw Error(
            "Recorded champion vision disagrees with its roster team",
          );
      }
      return { context, changes };
    });
  }
  return {
    observe,
    addCandidate(context, timeSeconds) {
      if (!dynamicActors)
        throw Error("Dynamic team vision actors are disabled");
      add(context, timeSeconds, undefined, true);
      if (timeSeconds === pendingTime) {
        const actor = actors.get(context);
        for (const { opcode, payload } of pending.get(context) ?? [])
          apply(actor, opcode, payload, timeSeconds);
        pending.delete(context);
      }
    },
    finish,
  };
}

export function readCurrentRecordedTeamVision(replay, scene, packets, codecs) {
  const worldActors = [
    scene.worldUnitModels,
    scene.structureModels,
    scene.inhibitorModels,
    scene.nexusModels,
  ].flatMap((group) =>
    (group?.instances ?? []).map(({ context, creationTimeSeconds }) => [
      context,
      creationTimeSeconds ?? 0,
    ]),
  );
  const collector = createCurrentRecordedTeamVisionCollector(
    replay,
    scene.participants,
    worldActors,
    codecs,
  );
  for (const packet of packets) collector.observe(packet);
  return collector.finish();
}
