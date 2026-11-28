// Scout-owned observation implementation; research paths re-export this module.
import { replayTimedPacketEnvelopes } from "./replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "./transport.mjs";

const levelByCode = new Map(
  [
    0x72, 0xc5, 0x51, 0x5e, 0x9d, 0x43, 0x5f, 0x81, 0x94, 0xf8, 0x9a, 0x89,
    0xae, 0x8f, 0x93, 0xef, 0x7c, 0x53,
  ].map((code, index) => [code, 3 + index]),
);
const decoder = new TextDecoder("utf-8", { fatal: true });
const defaultLevelCap = 18;
export const supportsLevelOverride = ({ build, protocol }) =>
  build === "16.23.840.6595" && protocol === "8bbfcd5af2bc92db";
export const maximumReplayActorLevel = (
  replay,
  { allowCurrentBuild = false } = {},
) =>
  allowCurrentBuild &&
  (replay.build === "16.23.841.8428" || replay.build === "16.23.841.3489") &&
  replay.protocol === "8bbfcd5af2bc92db"
    ? 20
    : supportsLevelOverride(replay)
      ? 19
      : defaultLevelCap;
const rotateByte = (value, shift) =>
  ((value << shift) | (value >>> (8 - shift))) & 0xff;

// The exact 16.23.840.6595 opcode 652 reader and setter store an optional
// override of the standard level cap.
export function readClassicLevelCap(payload) {
  const selector = payload[0] & 7;
  if (payload.length !== (selector < 4 ? 1 : 2))
    throw Error("Invalid recorded champion level-cap body");
  const encoded =
    selector < 4 ? [0x43, 0x83, 0xc2, 0x03][selector] : payload[1];
  const override = (rotateByte(rotateByte(encoded, 4) ^ 0xff, 6) + 14) & 0xff;
  return override || defaultLevelCap;
}

function footerLevels(replay, maximumLevel) {
  const bytes = replay.bytes.subarray(
    replay.end + 256,
    replay.bytes.length - 4,
  );
  const rows = JSON.parse(JSON.parse(decoder.decode(bytes)).statsJson);
  return rows.map(({ LEVEL }) => {
    if (
      typeof LEVEL !== "string" ||
      !/^(?:[1-9]|1[0-9]|20)$/.test(LEVEL) ||
      Number(LEVEL) > maximumLevel
    )
      throw Error("Invalid champion level in the replay footer");
    return Number(LEVEL);
  });
}

function nextLevel(actor, packet, maximumLevel) {
  const { payload, timeSeconds, secondTimeBits } = packet;
  if (actor.level === 1 && payload.length === 1) {
    if (payload[0] === 0x85) return 2;
    if (payload[0] === 0x82 && timeSeconds < 1) {
      actor.bootstrapClock = secondTimeBits;
      return 2;
    }
  } else if (actor.bootstrapClock !== null) {
    if (
      actor.bootstrapClock === secondTimeBits &&
      payload.length === 3 &&
      payload[1] === 0x16 &&
      payload[2] === 0x72
    ) {
      actor.bootstrapClock = null;
      return 3;
    }
  } else if (
    payload.length === 2 ||
    // The current opcode 1011 reader consumes both slots for selectors
    // A=1, B=1. This recorded six transition is distinct from opening
    // bootstrap and the separately verified two-byte level-20 transition.
    (maximumLevel === 20 &&
      payload.length === 3 &&
      (payload[0] & 0x3f) === 0x09 &&
      payload[1] === 0x16 &&
      payload[2] === 0x5e)
  ) {
    const level = levelByCode.get(payload.at(-1));
    if (
      level === actor.level + 1 &&
      level <= actor.levelCap &&
      level <= maximumLevel
    )
      return level;
    // Recorded 16.23.840.6595 matches also reannounce level nine.
    if (maximumLevel > defaultLevelCap && level === 9 && actor.level === 9)
      return 9;
  }
  throw Error("Unrecognized or nonconsecutive actor level notification");
}

/** Decode the observed 16.23 level notifications and reconcile the final roster. */
export function decodeActorLevelEnvelopes(
  envelopes,
  binding,
  expectedLevels,
  maximumLevel = defaultLevelCap,
) {
  const packets = [];
  let context;
  let opcode;
  for (const packet of envelopes) {
    if (packet.stream !== 1) continue;
    if (packet.blockOffset === 0) {
      context = 0;
      opcode = null;
    }
    opcode = packet.explicitOpcode ?? opcode;
    const { marker, paramBits } = packet;
    context =
      marker & 32 ? (context + ((paramBits << 24) >> 24)) >>> 0 : paramBits;
    if (opcode === 1011 || (maximumLevel > defaultLevelCap && opcode === 652))
      packets.push({ context, opcode, ...levelPacketFields(packet) });
  }
  return decodeActorLevelPackets(
    packets,
    binding,
    expectedLevels,
    maximumLevel,
  );
}

function levelPacketFields({ payload, timeSeconds, secondTimeBits }) {
  return {
    payload: new Uint8Array(payload.subarray(0, 4)),
    timeSeconds,
    secondTimeBits,
  };
}

function decodeActorLevelPackets(
  packets,
  binding,
  expectedLevels,
  maximumLevel,
) {
  const states = new Map();
  const visitedRows = new Set();
  for (const { context, footerRow } of [
    ...binding.verified,
    ...binding.unresolved.map((context) => ({ context, footerRow: null })),
  ]) {
    if (
      states.has(context) ||
      (footerRow !== null &&
        (!Number.isInteger(footerRow) ||
          footerRow < 1 ||
          footerRow > 10 ||
          visitedRows.has(footerRow)))
    )
      throw Error("Invalid verified actor binding");
    if (footerRow !== null) visitedRows.add(footerRow);
    states.set(context, {
      footerRow,
      level: 1,
      levelCap: defaultLevelCap,
      bootstrapClock: null,
    });
  }
  if (states.size !== 10 || expectedLevels.length !== 10)
    throw Error("Expected ten actor contexts and footer levels");

  const events = [];
  // Participant verification already ties consecutive contexts to the two
  // opening snapshot partitions, including its unresolved footer rows.
  const contexts = [...states.keys()].sort((a, b) => a - b);
  if (!contexts.every((context, index) => context === contexts[0] + index))
    throw Error("Invalid verified actor context sequence");
  const teams = new Map(
    contexts.map((context, index) => [context, Math.floor(index / 5)]),
  );
  for (const packet of packets) {
    const { context, opcode, timeSeconds, secondTimeBits } = packet;
    const actor = states.get(context);
    if (!actor) continue;
    if (opcode === 652) {
      actor.levelCap = readClassicLevelCap(packet.payload);
      continue;
    }
    const level = nextLevel(actor, packet, maximumLevel);
    if (level === actor.level) continue;
    actor.level = level;
    events.push({
      kind: "actor-level",
      context,
      footerRow: actor.footerRow,
      level: actor.level,
      timeSeconds,
      secondTimeBits,
    });
  }

  const remainingByTeam = [[], []];
  for (const [index, level] of expectedLevels.entries())
    if (!visitedRows.has(index + 1))
      remainingByTeam[Math.floor(index / 5)].push(level);
  const actualByTeam = [[], []];
  const finalLevels = [];
  for (const [context, { footerRow, level, bootstrapClock }] of states) {
    const team = teams.get(context);
    if (bootstrapClock !== null)
      throw Error("Incomplete opening level progression");
    if (footerRow === null) actualByTeam[team].push(level);
    else if (
      Math.floor((footerRow - 1) / 5) !== team ||
      expectedLevels[footerRow - 1] !== level
    )
      throw Error("Decoded level differs from the bound footer row");
    finalLevels.push({ context, footerRow, level });
  }
  if (
    actualByTeam.some(
      (levels, team) =>
        levels.sort().join() !== remainingByTeam[team].sort().join(),
    )
  )
    throw Error("Unbound levels differ from the footer team totals");
  return { initialLevel: 1, events, finalLevels };
}

/** Observe only level packet fields during the shared combat/binding scan. */
export function createReplayActorLevelObserver(replay, options) {
  const packets = [];
  const maximumLevel = maximumReplayActorLevel(replay, options);
  return {
    observeGameplayPacket(packet, opcode, context) {
      if (opcode === 1011 || (maximumLevel > defaultLevelCap && opcode === 652))
        packets.push({ context, opcode, ...levelPacketFields(packet) });
    },
    finish(binding) {
      return decodeActorLevelPackets(
        packets,
        binding,
        footerLevels(replay, maximumLevel),
        maximumLevel,
      );
    },
  };
}

export function readReplayActorLevels(replay, decompress, binding, options) {
  const maximumLevel = maximumReplayActorLevel(replay, options);
  const envelopes = replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, decompress),
  );
  return decodeActorLevelEnvelopes(
    envelopes,
    binding,
    footerLevels(replay, maximumLevel),
    maximumLevel,
  );
}
