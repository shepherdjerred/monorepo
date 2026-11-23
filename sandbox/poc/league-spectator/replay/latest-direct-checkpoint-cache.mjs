// Bounded retained simulation states, spread across the visited replay timeline.
// Keep the original private handles: their payloads are owned by runtime WeakMaps.
export function directCheckpointAtOrBefore(checkpoints, time) {
  let lo = 0,
    hi = checkpoints.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (checkpoints[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo ? checkpoints[lo - 1] : null;
}

export function retainDirectCheckpoint(checkpoints, saved, maximum) {
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    !Number.isFinite(saved.time) ||
    saved.time < 0
  )
    throw Error("Bounded absolute-time checkpoint cache required");
  const retained = checkpoints.slice();
  let lo = 0,
    hi = retained.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (retained[mid].time < saved.time) lo = mid + 1;
    else hi = mid;
  }
  if (retained[lo]?.time === saved.time) {
    if (
      retained[lo].tick !== saved.tick ||
      retained[lo].cursor !== saved.cursor
    )
      throw Error("Conflicting checkpoint schedule at one replay time");
    retained[lo] = saved;
  } else retained.splice(lo, 0, saved);
  if (maximum === 1) return [retained.at(-1)];
  while (retained.length > maximum) {
    // Drop the interior state with the smallest neighbouring span. Endpoints
    // remain available, and distant history survives a long uninterrupted play.
    let remove = 1,
      span = Infinity;
    for (let i = 1; i < retained.length - 1; i++) {
      const candidate = retained[i + 1].time - retained[i - 1].time;
      if (candidate < span) {
        remove = i;
        span = candidate;
      }
    }
    retained.splice(remove, 1);
  }
  return retained;
}
