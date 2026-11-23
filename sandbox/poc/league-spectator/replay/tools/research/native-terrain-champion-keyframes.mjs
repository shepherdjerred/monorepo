import { createReplayObservationActorSampler } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/decode.mjs";

const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";

/** Decode champion positions directly from their own verified keyframe packets. */
export function prepareNativeTerrainChampionKeyframes(prepared, readBody) {
  const { packetReader, observations } = prepared;
  if (
    packetReader.build !== build ||
    packetReader.protocol !== protocol ||
    observations.build !== build ||
    observations.protocol !== protocol ||
    typeof readBody !== "function"
  )
    throw Error("Expected the exact-build replay and opcode 944 decoder");

  const structureContexts = new Set(
    [...(observations.turrets ?? []), ...(observations.structures ?? [])].map(
      ({ context }) => context,
    ),
  );
  const contexts = new Set();
  const footerRows = new Set();
  for (const { context, footerRow } of observations.binding.verified) {
    if (
      !Number.isInteger(context) ||
      context <= 0 ||
      context > 0xffffffff ||
      !Number.isInteger(footerRow) ||
      footerRow < 1 ||
      footerRow > observations.roster.length ||
      contexts.has(context) ||
      structureContexts.has(context) ||
      footerRows.has(footerRow)
    )
      throw Error("Invalid verified champion position binding");
    contexts.add(context);
    footerRows.add(footerRow);
  }

  const sampleActors =
    contexts.size > 0 && observations.levels && observations.returns
      ? createReplayObservationActorSampler(observations)
      : null;
  const coverage = {
    verifiedParticipants: contexts.size,
    keyframes: packetReader.keyframes.length,
    populatedKeyframes: 0,
    admittedMarkers: 0,
    dead: 0,
    unknownLifecycle: 0,
    missingPacket: 0,
    missingVector: 0,
  };
  const frames = [];
  let previousTime = -1;
  for (const indexed of packetReader.keyframes) {
    const { timeSeconds } = indexed;
    if (!Number.isFinite(timeSeconds) || timeSeconds <= previousTime)
      throw Error("Invalid champion snapshot order");
    previousTime = timeSeconds;
    const markers = [];
    if (contexts.size === 0) {
      frames.push({ timeSeconds, markers });
      continue;
    }
    const actors = new Map(
      sampleActors?.(timeSeconds).map((row) => [row.context, row]) ?? [],
    );
    const { keyframe, packets } = packetReader.read(timeSeconds);
    if (
      indexed.chunkOffset !== keyframe.chunkOffset ||
      timeSeconds !== keyframe.timeSeconds
    )
      throw Error("Replay did not return the indexed champion snapshot");
    const bodies = new Map();
    let opcode = null;
    let context = 0;
    for (const packet of packets) {
      if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
        break;
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      if (opcode !== 944 || !contexts.has(context)) continue;
      if (bodies.has(context))
        throw Error("Duplicate champion 944 packet in one snapshot");
      bodies.set(context, packet.payload);
    }
    for (const participantId of contexts) {
      const actor = actors.get(participantId);
      const body = bodies.get(participantId);
      if (actor?.dead) {
        coverage.dead++;
      } else if (actor === undefined && timeSeconds !== 0) {
        coverage.unknownLifecycle++;
      } else if (body === undefined) {
        coverage.missingPacket++;
      } else {
        const position = readBody(body);
        if (position === null) {
          coverage.missingVector++;
        } else {
          const { x, z } = position;
          if (!Number.isFinite(x) || !Number.isFinite(z))
            throw Error("Invalid decoded champion snapshot position");
          markers.push({ participantId, x, z });
        }
      }
    }
    if (markers.length) coverage.populatedKeyframes++;
    coverage.admittedMarkers += markers.length;
    frames.push({ timeSeconds, markers });
  }
  return { frames, coverage };
}
