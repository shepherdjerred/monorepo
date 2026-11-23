// Scout-owned observation implementation; research paths re-export this module.
import { verifyReplayParticipantBindings } from "./replay-participant-bindings.mjs";
import { createReplayTurretObserver } from "./replay-turret-events.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class ReplayStructureValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplayStructureValidationError";
  }
}

function countInhibitorLosses(replay) {
  const input = replay.bytes.subarray(
    replay.end + 256,
    replay.bytes.length - 4,
  );
  const rows = JSON.parse(JSON.parse(decoder.decode(input)).statsJson);
  if (rows.length !== 10)
    throw new ReplayStructureValidationError(
      "Expected ten footer inhibitor rows",
    );
  const total = rows.reduce((sum, { BARRACKS_KILLED }) => {
    if (
      typeof BARRACKS_KILLED !== "string" ||
      !/^\d+$/.test(BARRACKS_KILLED) ||
      !Number.isSafeInteger(Number(BARRACKS_KILLED))
    )
      throw new ReplayStructureValidationError(
        "Invalid inhibitor kills in the replay footer",
      );
    return sum + Number(BARRACKS_KILLED);
  }, 0);
  if (!Number.isSafeInteger(total))
    throw new ReplayStructureValidationError("Invalid total inhibitor kills");
  return total;
}

const key = ({ context, secondTimeBits }) => `${context}/${secondTimeBits}`;
const destructionMark = 1;
const inhibitorNotice = 2;
const inhibitorLoss = 4;
const terminalWidth = 8;

/** Verify non-turret structures by cross-packet evidence and footer counts. */
export function verifyReplayStructureEvents(
  deaths,
  localized,
  terminal,
  binding,
  turrets,
  expected,
  duration,
) {
  const actorContexts = new Set([
    ...binding.verified.map(({ context }) => context),
    ...binding.unresolved,
  ]);
  const turretKeys = new Set(turrets.map(key));
  const verified = [];
  let inhibitors = 0;
  let terminalCount = 0;
  const witnessed = new Set();
  for (const candidate of deaths) {
    if (actorContexts.has(candidate.context)) continue;
    const id = key(candidate);
    if (turretKeys.has(id) || witnessed.has(id)) continue;
    const signals = localized.get(id) ?? 0;
    const global = terminal.get(candidate.secondTimeBits);
    const remaining = duration - candidate.timeSeconds;
    let kind;
    if (
      (signals & (destructionMark | inhibitorNotice | inhibitorLoss)) ===
      (destructionMark | inhibitorNotice | inhibitorLoss)
    ) {
      kind = "inhibitor-destruction";
      inhibitors++;
    } else if (
      (signals & terminalWidth) !== 0 &&
      global?.first === 2 &&
      global.second === 2 &&
      global.result === 1 &&
      remaining >= 3.73 &&
      remaining <= 3.75
    ) {
      kind = "match-ending-structure-loss";
      terminalCount++;
    } else {
      throw new ReplayStructureValidationError(
        "Uncorroborated non-champion structure death",
      );
    }
    witnessed.add(id);
    verified.push({ kind, ...candidate });
  }
  if (
    inhibitors !== expected ||
    terminalCount !== 1 ||
    verified.at(-1)?.kind !== "match-ending-structure-loss"
  )
    throw new ReplayStructureValidationError(
      "Structure outcomes disagree with the replay footer",
    );
  return verified;
}

export function createReplayStructureObserver(replay) {
  if (
    (replay.build !== "16.23.839.9929" && replay.build !== "16.23.840.6595") ||
    replay.protocol !== "8bbfcd5af2bc92db"
  )
    throw new ReplayStructureValidationError(
      "Unsupported structure event build or protocol",
    );
  const expected = countInhibitorLosses(replay);
  const deaths = [];
  const localized = new Map();
  const terminal = new Map();
  return {
    observeGameplayPacket(
      { timeSeconds, secondTimeBits, payload },
      opcode,
      context,
    ) {
      const length = payload.length;
      if (opcode === 172 && length === 116)
        deaths.push({ context, timeSeconds, secondTimeBits });
      const marks =
        opcode === 47
          ? destructionMark | (length >= 1 && length <= 4 ? terminalWidth : 0)
          : opcode === 947 && (length === 1 || length === 3)
            ? inhibitorNotice
            : opcode === 760 && length === 24
              ? inhibitorLoss
              : 0;
      if (marks) {
        const id = key({ context, secondTimeBits });
        localized.set(id, (localized.get(id) ?? 0) | marks);
      }
      if (context !== 0) return;
      const signal =
        opcode === 767 && length === 0
          ? "first"
          : opcode === 1140 && length === 0
            ? "second"
            : opcode === 622 && (length === 3 || length === 5)
              ? "result"
              : null;
      if (signal) {
        const counts = terminal.get(secondTimeBits) ?? {
          first: 0,
          second: 0,
          result: 0,
        };
        counts[signal]++;
        terminal.set(secondTimeBits, counts);
      }
    },
    finish(binding, turrets) {
      return verifyReplayStructureEvents(
        deaths,
        localized,
        terminal,
        binding,
        turrets,
        expected,
        replay.duration,
      );
    },
  };
}

export function readReplayStructureEvents(replay, decompress) {
  const structures = createReplayStructureObserver(replay);
  const turrets = createReplayTurretObserver(replay);
  const binding = verifyReplayParticipantBindings(replay, decompress, {
    observeGameplayPacket(packet, opcode, context) {
      structures.observeGameplayPacket(packet, opcode, context);
      turrets.observeGameplayPacket(packet, opcode, context);
    },
  });
  return structures.finish(binding, turrets.finish(binding));
}
