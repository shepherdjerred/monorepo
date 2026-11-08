// Exact packet provenance, candidate semantics. Timers never manufacture deaths
// or respawns; an explicit respawn event closes each death interval.
export function prepareLatestLifecycle(report) {
  const tracks = new Map(),
    open = new Map(),
    repeatedDeaths = [],
    unmatchedRespawns = [];
  let previousTime = -Infinity,
    previousSequence = -1;
  for (const event of report.lifecycle) {
    if (
      !Number.isFinite(event.time) ||
      !Number.isInteger(event.sequence) ||
      !Number.isInteger(event.entityId)
    )
      throw Error("Invalid lifecycle event provenance");
    if (
      event.time < previousTime ||
      (event.time === previousTime && event.sequence <= previousSequence)
    )
      throw Error("Lifecycle events must retain transport ordering");
    previousTime = event.time;
    previousSequence = event.sequence;
    if (event.kind === "respawn-timer-candidate") continue;
    if (event.kind === "death-candidate") {
      if (open.has(event.entityId)) {
        repeatedDeaths.push(event);
        continue;
      }
      const interval = { death: event, respawn: null, postDeathActions: [] };
      if (!tracks.has(event.entityId)) tracks.set(event.entityId, []);
      tracks.get(event.entityId).push(interval);
      open.set(event.entityId, interval);
    } else if (event.kind === "respawn-candidate") {
      const interval = open.get(event.entityId);
      if (!interval) {
        unmatchedRespawns.push(event);
        continue;
      }
      interval.respawn = event;
      open.delete(event.entityId);
    } else throw Error(`Unsupported lifecycle event ${event.kind}`);
  }
  for (const [id, intervals] of tracks) {
    for (const interval of intervals)
      interval.postDeathActions = report.casts.filter(
        (event) =>
          event.entityId === id &&
          event.time > interval.death.time &&
          event.time < (interval.respawn?.time ?? Infinity),
      );
  }
  return { tracks, repeatedDeaths, unmatchedRespawns };
}

export function sampleLatestLifecycle(track, time) {
  let lo = 0,
    hi = track?.length ?? 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].death.time <= time) lo = mid + 1;
    else hi = mid;
  }
  const interval = lo ? track[lo - 1] : null;
  return {
    dead: !!interval && (!interval.respawn || time < interval.respawn.time),
    interval,
    respawn:
      interval?.respawn && time >= interval.respawn.time
        ? interval.respawn
        : null,
  };
}

// The last movement update can predate a respawn packet. Respect that recorded
// respawn point until a later path actually takes ownership.
export function movementFollowsRespawn(state, respawn) {
  return (
    !respawn ||
    (state &&
      (state.event.time > respawn.time ||
        (state.event.time === respawn.time &&
          state.event.sequence > respawn.sequence)))
  );
}

// Shared preview convention, not a recovered native death-animation controller.
// Model retention is evaluated separately; this only selects/clamps pose layers.
export function sampleLatestDeathPosePreview(graph, life, time) {
  if (!life.dead || life.interval.postDeathActions.length) return null;
  if (!Number.isFinite(time) || time < life.interval.death.time)
    throw Error("Invalid death pose clock");
  const start = graph.evaluate("Death", 0, { moving: false });
  if (
    start.unresolved.length ||
    !Number.isFinite(start.duration) ||
    start.duration <= 0
  )
    throw Error("Death graph cannot be presented by the current package");
  const phase = Math.min(
    time - life.interval.death.time,
    Math.max(0, start.duration - 0.000001),
  );
  return graph.evaluate("Death", phase, { moving: false });
}
