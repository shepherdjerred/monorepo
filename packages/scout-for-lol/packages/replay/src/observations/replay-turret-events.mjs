// Scout-owned observation implementation; research paths re-export this module.
import { verifyReplayParticipantBindings } from "./replay-participant-bindings.mjs";

const destructionWidths = new Set([27, 29, 30, 31, 32, 33]);
const decoder = new TextDecoder("utf-8", { fatal: true });

export class ReplayTurretValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplayTurretValidationError";
  }
}

export function readReplayTurretLossCounts(replay) {
  const stats = JSON.parse(
    decoder.decode(
      replay.bytes.subarray(replay.end + 256, replay.bytes.length - 4),
    ),
  );
  const rows = JSON.parse(stats.statsJson);
  if (rows.length !== 10)
    throw new ReplayTurretValidationError(
      "Expected ten footer turret-loss rows",
    );
  const lossCounts = rows.map(({ FRIENDLY_TURRET_LOST }) => {
    if (
      typeof FRIENDLY_TURRET_LOST !== "string" ||
      !/^\d+$/.test(FRIENDLY_TURRET_LOST) ||
      !Number.isSafeInteger(Number(FRIENDLY_TURRET_LOST))
    )
      throw new ReplayTurretValidationError(
        "Invalid friendly turret losses in the replay footer",
      );
    return Number(FRIENDLY_TURRET_LOST);
  });
  if (
    lossCounts.some((count, index) => count !== lossCounts[index < 5 ? 0 : 5])
  )
    throw new ReplayTurretValidationError(
      "Friendly turret losses differ within a footer team",
    );
  const expected = lossCounts[0] + lossCounts[5];
  if (!Number.isSafeInteger(expected))
    throw new ReplayTurretValidationError("Invalid total turret losses");
  return [lossCounts[0], lossCounts[5]];
}

/** Require a global notice and a same-context death on each recorded clock. */
export function verifyTurretDestructions(
  candidates,
  notices,
  deaths,
  binding,
  expected,
  duration,
) {
  if (candidates.length !== expected || notices.size !== expected)
    throw new ReplayTurretValidationError(
      "Turret packet counts differ from the footer losses",
    );
  const actorContexts = new Set([
    ...binding.verified.map(({ context }) => context),
    ...binding.unresolved,
  ]);
  const structures = new Set();
  const clocks = new Set();
  return candidates.map(({ context, timeSeconds, secondTimeBits }) => {
    if (
      actorContexts.has(context) ||
      structures.has(context) ||
      clocks.has(secondTimeBits) ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > duration ||
      !notices.has(secondTimeBits) ||
      !deaths.get(context)?.has(secondTimeBits)
    )
      throw new ReplayTurretValidationError(
        "Turret destruction lacks a distinct corroborated context and clock",
      );
    structures.add(context);
    clocks.add(secondTimeBits);
    return { kind: "turret-destruction", context, timeSeconds, secondTimeBits };
  });
}

export function createReplayTurretObserver(replay) {
  if (
    (replay.build !== "16.23.839.9929" && replay.build !== "16.23.840.6595") ||
    replay.protocol !== "8bbfcd5af2bc92db"
  )
    throw new ReplayTurretValidationError(
      "Unsupported turret event build or protocol",
    );
  const [first, second] = readReplayTurretLossCounts(replay);
  const expected = first + second;
  const candidates = [];
  const notices = new Set();
  const deaths = new Map();
  return {
    observeGameplayPacket(packet, opcode, context) {
      const { timeSeconds, secondTimeBits, payload } = packet;
      if (opcode === 557) {
        if (
          candidates.length >= expected ||
          !destructionWidths.has(payload.length)
        )
          throw new ReplayTurretValidationError(
            "Unexpected turret-destruction candidate packet",
          );
        candidates.push({ context, timeSeconds, secondTimeBits });
      } else if (opcode === 675) {
        if (
          context !== 0 ||
          (payload.length !== 3 && payload.length !== 5) ||
          notices.size >= expected ||
          notices.has(secondTimeBits)
        )
          throw new ReplayTurretValidationError(
            "Unexpected global turret notice packet",
          );
        notices.add(secondTimeBits);
      } else if (opcode === 172 && payload.length === 116) {
        const clocks = deaths.get(context) ?? new Set();
        clocks.add(secondTimeBits);
        deaths.set(context, clocks);
      }
    },
    finish(binding) {
      return verifyTurretDestructions(
        candidates,
        notices,
        deaths,
        binding,
        expected,
        replay.duration,
      );
    },
  };
}

export function readReplayTurretDestructions(replay, decompress) {
  const observer = createReplayTurretObserver(replay);
  return observer.finish(
    verifyReplayParticipantBindings(replay, decompress, observer),
  );
}
