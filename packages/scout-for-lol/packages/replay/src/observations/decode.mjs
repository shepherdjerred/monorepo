import { openReplay } from "./transport.mjs";
import { createReplayKdaTimeline } from "./replay-actor-kda.mjs";
import { verifyReplayParticipantBindings } from "./replay-participant-bindings.mjs";
import { createReplayActorLevelObserver } from "./replay-actor-levels.mjs";
import { createReplayActorStateSampler } from "./replay-actor-state.mjs";
import {
  ChampionReturnValidationError,
  createChampionReturnObserver,
} from "./replay-champion-lifecycle.mjs";
import {
  ReplayTurretValidationError,
  createReplayTurretObserver,
} from "./replay-turret-events.mjs";
import {
  ReplayTurretSideValidationError,
  createReplayTurretSideObserver,
} from "./replay-turret-sides.mjs";
import {
  ReplayStructureValidationError,
  createReplayStructureObserver,
} from "./replay-structure-events.mjs";

function optionalEvidence(read, ValidationError) {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return null;
  }
}

function optionalObserver(create, ValidationError) {
  let observer = optionalEvidence(create, ValidationError);
  return {
    observeGameplayPacket(packet, opcode, context) {
      try {
        observer?.observeGameplayPacket(packet, opcode, context);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        observer = null;
      }
    },
    finish(...inputs) {
      return optionalEvidence(
        () => observer?.finish(...inputs) ?? null,
        ValidationError,
      );
    },
  };
}

function aliveCheckpoints(replay, binding, levels, returns) {
  const sample = createReplayActorStateSampler({
    replay,
    binding,
    levels,
    returns,
  });
  const times = [
    0,
    ...binding.events
      .filter(({ kind }) => kind === "champion-death")
      .map(({ timeSeconds }) => timeSeconds),
    ...returns.map(({ timeSeconds }) => timeSeconds),
  ].sort((a, b) => a - b);
  const lastTimeInMillisecond = new Map(
    times.map((time) => [Math.ceil(time * 1000), time]),
  );
  const checkpoints = [];
  for (const [timestampMs, time] of lastTimeInMillisecond) {
    const teams = [0, 0];
    for (const { partition, dead } of sample(time))
      if (!dead) teams[partition]++;
    const previous = checkpoints.at(-1);
    if (previous?.teamA !== teams[0] || previous.teamB !== teams[1])
      checkpoints.push({ timestampMs, teamA: teams[0], teamB: teams[1] });
  }
  return checkpoints;
}

/** Exact-build recorded observations only; no scene, worker, fetch, or render admission. */
export function decodeReplayObservations(
  buffer,
  decompress,
  { lifecycle = true } = {},
) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    typeof decompress !== "function" ||
    typeof lifecycle !== "boolean"
  )
    throw Error(
      "Original ArrayBuffer, injected decompressor and lifecycle selection required",
    );
  const replay = openReplay(buffer);
  return decodeParsedReplayObservations(replay, decompress, { lifecycle });
}

/** Internal shared traversal seam; callers never supply this hook through the package API. */
export function decodeParsedReplayObservations(
  replay,
  decompress,
  { lifecycle = true, observeRawPacket } = {},
) {
  const levelObserver = lifecycle
    ? createReplayActorLevelObserver(replay)
    : null;
  const returnObserver = levelObserver
    ? optionalObserver(
        () => createChampionReturnObserver(replay),
        ChampionReturnValidationError,
      )
    : null;
  const turretObserver = levelObserver
    ? optionalObserver(
        () => createReplayTurretObserver(replay),
        ReplayTurretValidationError,
      )
    : null;
  const structureObserver = levelObserver
    ? optionalObserver(
        () => createReplayStructureObserver(replay),
        ReplayStructureValidationError,
      )
    : null;
  const turretSideObserver = levelObserver
    ? optionalObserver(
        () => createReplayTurretSideObserver(replay),
        ReplayTurretSideValidationError,
      )
    : null;
  const binding = verifyReplayParticipantBindings(
    replay,
    decompress,
    levelObserver === null && observeRawPacket === undefined
      ? undefined
      : {
          ...(observeRawPacket === undefined ? {} : { observeRawPacket }),
          observeGameplayPacket(packet, opcode, context) {
            levelObserver?.observeGameplayPacket(packet, opcode, context);
            returnObserver?.observeGameplayPacket(packet, opcode, context);
            turretObserver?.observeGameplayPacket(packet, opcode, context);
            turretSideObserver?.observeGameplayPacket(packet, opcode, context);
            structureObserver?.observeGameplayPacket(packet, opcode, context);
          },
        },
  );
  if (binding.events.some(({ timeSeconds }) => timeSeconds > replay.duration))
    throw Error("A combat event extends beyond the recorded replay duration.");
  const levels = levelObserver?.finish(binding) ?? null;
  const returns = returnObserver?.finish(binding) ?? null;
  const turrets = turretObserver?.finish(binding) ?? null;
  const turretsWithSides =
    turrets === null
      ? null
      : (turretSideObserver?.finish(binding, turrets) ??
        turrets.map((event) => ({ ...event, defendingPartition: null })));
  const structures =
    turrets === null
      ? null
      : (structureObserver?.finish(binding, turrets) ?? null);
  if (levels?.events.some(({ timeSeconds }) => timeSeconds > replay.duration))
    throw Error("A level event extends beyond the recorded replay duration.");
  return {
    build: replay.build,
    protocol: replay.protocol,
    duration: replay.duration,
    roster: replay.roster,
    binding,
    levels,
    returns,
    turrets: turretsWithSides,
    structures,
    aliveCounts:
      levels === null || returns === null
        ? null
        : aliveCheckpoints(replay, binding, levels, returns),
  };
}

/** Random-access position-free lifecycle/KDA facts, with unresolved identities intact. */
export function createReplayObservationActorSampler(observations) {
  return createReplayActorStateSampler({
    replay: observations,
    binding: observations.binding,
    levels: observations.levels,
    returns: observations.returns,
  });
}

/** K/D/A alone does not require the optional level/return channels. */
export function createReplayObservationKdaTimeline(observations) {
  return createReplayKdaTimeline(observations, observations.binding);
}
