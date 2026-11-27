// Scout-owned observation implementation; research paths re-export this module.
import {
  createReplayActorKdaTracks,
  sampleReplayActorKda,
} from "./replay-actor-kda.mjs";
import { maximumReplayActorLevel } from "./replay-actor-levels.mjs";
function withinReplay(timeSeconds, duration) {
  return (
    Number.isFinite(timeSeconds) && timeSeconds >= 0 && timeSeconds <= duration
  );
}

function latestAt(events, timeSeconds) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].timeSeconds <= timeSeconds) low = middle + 1;
    else high = middle;
  }
  return events[low - 1];
}

/** Prepare position-free, random-access state from verified same-replay facts. */
export function createReplayActorStateSampler({
  replay,
  binding,
  levels,
  returns,
}) {
  const { duration, roster } = replay;
  if (!Number.isFinite(duration) || duration <= 0 || roster.length !== 10)
    throw Error("Invalid actor state replay scope");
  if (
    levels?.initialLevel !== 1 ||
    !Array.isArray(levels.events) ||
    !Array.isArray(returns)
  )
    throw Error("Actor state requires verified level and return evidence");
  const { initialLevel } = levels;
  const maximumDecodedLevel = maximumReplayActorLevel(replay, {
    allowCurrentBuild: true,
  });
  const tracks = createReplayActorKdaTracks(replay, binding);
  for (const track of tracks.values()) {
    track.levels = [];
    track.lifecycle = [];
  }

  for (const {
    context,
    footerRow,
    kind,
    level,
    timeSeconds,
  } of levels.events) {
    const track = tracks.get(context);
    const previous = track?.levels.at(-1);
    if (
      !track ||
      footerRow !== track.footerRow ||
      kind !== "actor-level" ||
      !withinReplay(timeSeconds, duration) ||
      timeSeconds < (previous?.timeSeconds ?? 0) ||
      level !== (previous?.level ?? initialLevel) + 1 ||
      level > maximumDecodedLevel
    )
      throw Error("Invalid verified actor level transition");
    track.levels.push({ timeSeconds, level });
  }

  const deaths = binding.events.filter(({ kind }) => kind === "champion-death");
  for (const { context, partition, timeSeconds, kind } of [
    ...deaths,
    ...returns,
  ]) {
    const track = tracks.get(context);
    if (
      !track ||
      partition !== track.partition ||
      !withinReplay(timeSeconds, duration) ||
      (kind !== "champion-death" && kind !== "champion-return")
    )
      throw Error("Invalid verified actor lifecycle transition");
    track.lifecycle.push({ timeSeconds, dead: kind === "champion-death" });
  }
  for (const track of tracks.values()) {
    track.lifecycle.sort((a, b) => a.timeSeconds - b.timeSeconds);
    let previous = { dead: false, timeSeconds: -Infinity };
    for (const event of track.lifecycle) {
      if (
        event.dead === previous.dead ||
        event.timeSeconds <= previous.timeSeconds
      )
        throw Error(
          "Actor lifecycle evidence does not alternate in recorded time",
        );
      previous = event;
    }
  }

  return function sample(timeSeconds) {
    if (!withinReplay(timeSeconds, duration))
      throw Error("Actor state sample time is outside the recorded replay");
    return Array.from(tracks.values(), (track) => ({
      context: track.context,
      partition: track.partition,
      footerRow: track.footerRow,
      champion: track.champion,
      level: latestAt(track.levels, timeSeconds)?.level ?? initialLevel,
      dead: latestAt(track.lifecycle, timeSeconds)?.dead ?? false,
      kda: sampleReplayActorKda(track, timeSeconds),
    }));
  };
}
