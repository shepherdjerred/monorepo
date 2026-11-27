import {
  createReplayObservationActorSampler,
  createReplayObservationEliminations,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations.ts";
import { readInventoryReplayFooter } from "./verify-recorded-inventory-footer.mjs";

export function projectRecordedPlayerState(observations, participantIds) {
  const { binding, levels, returns } = observations;
  const championEliminations = createReplayObservationEliminations(binding);
  if (levels === null || returns === null) return { championEliminations };

  const sample = createReplayObservationActorSampler(observations);
  const times = new Set([0]);
  for (const { timeSeconds } of [
    ...binding.events,
    ...binding.assists,
    ...levels.events,
    ...returns,
  ]) {
    times.add(timeSeconds);
  }
  const checkpoints = [...times]
    .sort((left, right) => left - right)
    .map((timeSeconds) => {
      const actors = sample(timeSeconds);
      if (actors.length !== participantIds.size)
        throw Error("Player state lacks a complete scene roster");
      const players = actors.map(({ context, footerRow, level, dead, kda }) => {
        if (!participantIds.has(context) || footerRow === null || kda === null)
          throw Error("Player state lacks a verified scene participant");
        return { participantId: context, ...kda, level, alive: !dead };
      });
      return { timeSeconds, players };
    });
  return { championEliminations, playerState: { checkpoints } };
}

/** Validate newly resolved identities against already decoded level histories. */
function rebindRecordedLevels(replay, levels, binding) {
  const rows = JSON.parse(readInventoryReplayFooter(replay.bytes).statsJson);
  const byContext = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  const finalLevels = levels.finalLevels.map((entry) => {
    const footerRow = byContext.get(entry.context);
    if (
      (entry.footerRow !== null && entry.footerRow !== footerRow) ||
      rows[footerRow - 1]?.LEVEL !== String(entry.level)
    )
      throw Error(
        "Recorded level disagrees with the resolved replay participant",
      );
    return { ...entry, footerRow };
  });
  const events = levels.events.map((event) => ({
    ...event,
    footerRow: byContext.get(event.context),
  }));
  return { ...levels, finalLevels, events };
}

export function readCurrentRecordedPlayerState(replay, observations, binding) {
  if (
    binding.verified.length !== 10 ||
    binding.unresolved.length !== 0 ||
    new Set(binding.verified.map(({ footerRow }) => footerRow)).size !== 10 ||
    new Set(binding.verified.map(({ context }) => context)).size !== 10 ||
    observations.levels === null ||
    observations.returns === null
  )
    throw Error(
      "Recorded player state requires complete levels, returns, and participants",
    );
  const levels =
    binding.verified.length === observations.binding.verified.length
      ? observations.levels
      : rebindRecordedLevels(replay, observations.levels, binding);
  return {
    ...projectRecordedPlayerState(
      { ...observations, levels, binding },
      new Set(binding.verified.map(({ context }) => context)),
    ),
    ...(replay.winningTeam === null ? {} : { winningTeam: replay.winningTeam }),
  };
}
