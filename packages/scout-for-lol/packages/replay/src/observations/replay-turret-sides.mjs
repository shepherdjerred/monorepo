// Scout-owned observation implementation; research paths re-export this module.
import { verifyReplayParticipantBindings } from "./replay-participant-bindings.mjs";
import {
  createReplayTurretObserver,
  readReplayTurretLossCounts,
  ReplayTurretValidationError,
} from "./replay-turret-events.mjs";

export class ReplayTurretSideValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplayTurretSideValidationError";
  }
}

export function attributeTurretSides(
  events,
  primary,
  corroborating,
  binding,
  expected,
) {
  const partitions = new Map(
    binding.verified.map(({ context, footerRow }) => [
      context,
      Math.floor((footerRow - 1) / 5),
    ]),
  );
  const unresolved = new Set(binding.unresolved);
  const sideAt = (packets, clock) => {
    const sides = new Set();
    let hasUnresolvedActor = false;
    for (const context of packets.get(clock) ?? []) {
      if (partitions.has(context)) sides.add(partitions.get(context));
      else if (unresolved.has(context)) hasUnresolvedActor = true;
    }
    return { sides, hasUnresolvedActor };
  };
  const counts = [0, 0];
  let missing = 0;
  if (events.length !== expected[0] + expected[1])
    throw new ReplayTurretSideValidationError(
      "Turret event count differs from the footer losses",
    );
  const attributed = events.map((event) => {
    const attacking = sideAt(primary, event.secondTimeBits);
    if (attacking.sides.size !== 1 || attacking.hasUnresolvedActor) {
      missing++;
      return { ...event, defendingPartition: null };
    }
    const defendingPartition = 1 - attacking.sides.values().next().value;
    const witness = sideAt(corroborating, event.secondTimeBits);
    if (witness.sides.has(defendingPartition))
      throw new ReplayTurretSideValidationError(
        "Turret side witnesses conflict at the recorded clock",
      );
    if (witness.hasUnresolvedActor) {
      missing++;
      return { ...event, defendingPartition: null };
    }
    counts[defendingPartition]++;
    return { ...event, defendingPartition };
  });
  if (
    counts.some(
      (count, side) =>
        count > expected[side] || (!missing && count !== expected[side]),
    )
  )
    throw new ReplayTurretSideValidationError(
      "Defending turret partitions differ from footer losses",
    );
  return attributed;
}

export function createReplayTurretSideObserver(replay) {
  let expected;
  try {
    expected = readReplayTurretLossCounts(replay);
  } catch (error) {
    if (!(error instanceof ReplayTurretValidationError)) throw error;
    throw new ReplayTurretSideValidationError(error.message);
  }
  const primary = new Map();
  const corroborating = new Map();
  return {
    observeGameplayPacket({ secondTimeBits }, opcode, context) {
      if (opcode !== 270 && opcode !== 288) return;
      const map = opcode === 270 ? primary : corroborating;
      const contexts = map.get(secondTimeBits) ?? new Set();
      contexts.add(context);
      map.set(secondTimeBits, contexts);
    },
    finish(binding, turretEvents) {
      return attributeTurretSides(
        turretEvents,
        primary,
        corroborating,
        binding,
        expected,
      );
    },
  };
}

export function readReplayTurretSides(replay, decompress) {
  const side = createReplayTurretSideObserver(replay);
  const turrets = createReplayTurretObserver(replay);
  const binding = verifyReplayParticipantBindings(replay, decompress, {
    observeGameplayPacket(packet, opcode, context) {
      side.observeGameplayPacket(packet, opcode, context);
      turrets.observeGameplayPacket(packet, opcode, context);
    },
  });
  return side.finish(binding, turrets.finish(binding));
}
