const combatStat = new Map([
  ["champion-kill", "kills"],
  ["champion-death", "deaths"],
  ["champion-assist", "assists"],
]);
const initialKda = { kills: 0, deaths: 0, assists: 0 };

/** Shared verified fold; intentionally independent of level and return evidence. */
export function createReplayActorKdaTracks(replay, binding) {
  const { duration, roster } = replay;
  if (!Number.isFinite(duration) || duration <= 0 || roster.length !== 10)
    throw Error("Invalid actor state replay scope");
  if (!Array.isArray(binding.assists))
    throw Error("Actor state requires verified assist evidence");
  const actors = [
    ...binding.verified,
    ...binding.unresolved.map((context) => ({ context, footerRow: null })),
  ].sort((a, b) => a.context - b.context);
  const rows = new Set(),
    tracks = new Map();
  if (actors.length !== 10) throw Error("Expected ten verified actor contexts");
  for (const [index, { context, footerRow }] of actors.entries()) {
    const partition = Math.floor(index / 5);
    if (
      !Number.isSafeInteger(context) ||
      context < 0 ||
      context !== actors[0].context + index ||
      (footerRow !== null &&
        (!Number.isInteger(footerRow) ||
          footerRow < 1 ||
          footerRow > 10 ||
          rows.has(footerRow) ||
          Math.floor((footerRow - 1) / 5) !== partition))
    )
      throw Error("Invalid actor state binding");
    rows.add(footerRow);
    tracks.set(context, {
      context,
      partition,
      footerRow,
      champion: footerRow === null ? null : roster[footerRow - 1].champion,
      kda: [],
    });
  }
  const combat = [...binding.events, ...binding.assists].sort(
    (a, b) => a.timeSeconds - b.timeSeconds,
  );
  for (const { context, partition, timeSeconds, kind } of combat) {
    const track = tracks.get(context),
      stat = combatStat.get(kind);
    if (
      !track ||
      partition !== track.partition ||
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds > duration ||
      !stat
    )
      throw Error("Invalid verified actor K/D/A event");
    const counts = { ...(track.kda.at(-1)?.counts ?? initialKda) };
    counts[stat]++;
    track.kda.push({ timeSeconds, counts });
  }
  return tracks;
}

export function sampleReplayActorKda(track, timeSeconds) {
  if (track.footerRow === null) return null;
  let low = 0,
    high = track.kda.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (track.kda[middle].timeSeconds <= timeSeconds) low = middle + 1;
    else high = middle;
  }
  return { ...(track.kda[low - 1]?.counts ?? initialKda) };
}

/** Privacy-safe integer-display-clock projection, merging each millisecond once. */
export function createReplayKdaTimeline(replay, binding) {
  const tracks = createReplayActorKdaTracks(replay, binding);
  const times = [
    0,
    ...binding.events.map(({ timeSeconds }) => timeSeconds),
    ...binding.assists.map(({ timeSeconds }) => timeSeconds),
  ].sort((a, b) => a - b);
  const lastTimeInMillisecond = new Map(
    times.map((time) => [Math.ceil(time * 1000), time]),
  );
  return {
    actors: Array.from(tracks.values(), ({ partition, champion }) => ({
      partition,
      champion,
    })),
    checkpoints: Array.from(lastTimeInMillisecond, ([timestampMs, time]) => ({
      timestampMs,
      kda: Array.from(tracks.values(), (track) =>
        sampleReplayActorKda(track, time),
      ),
    })),
  };
}
