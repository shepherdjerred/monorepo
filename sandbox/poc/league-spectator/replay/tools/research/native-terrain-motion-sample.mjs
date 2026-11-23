export function latestAt(events, timeSeconds) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (events[middle].timeSeconds <= timeSeconds) low = middle + 1;
    else high = middle;
  }
  return events[low - 1];
}

export function samplePath(event, timeSeconds) {
  const knot = latestAt(event.speeds, timeSeconds);
  let distance = knot.distance + (timeSeconds - knot.timeSeconds) * knot.speed;
  let point = event.points[0];
  let direction = null;
  for (let index = 1; index < event.points.length; index++) {
    const target = event.points[index];
    const dx = target[0] - point[0];
    const dz = target[1] - point[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    direction = [dx / length, dz / length];
    if (distance < length) {
      return {
        x: point[0] + direction[0] * distance,
        z: point[1] + direction[1] * distance,
        moving: knot.speed > 0,
        direction,
        arrived: false,
      };
    }
    distance -= length;
    point = target;
  }
  return { x: point[0], z: point[1], moving: false, direction, arrived: true };
}

function sampleTrack(track, timeSeconds) {
  const event = latestAt(track.events, timeSeconds);
  const snapshot = latestAt(track.snapshots, timeSeconds);
  if (event?.kind === "death") return { status: "dead" };
  const returnTime = latestAt(track.returns, timeSeconds)?.timeSeconds ?? 0;
  const anchor = snapshot?.timeSeconds >= returnTime ? snapshot : null;
  if (anchor?.timeSeconds === timeSeconds)
    return { status: "keyframe", x: anchor.x, z: anchor.z };
  if (event?.kind === "path") {
    const path = samplePath(event, timeSeconds);
    if (!path.arrived || !(anchor?.timeSeconds > event.timeSeconds)) {
      return {
        status: path.moving ? "moving" : "waypointStationary",
        x: path.x,
        z: path.z,
        direction: path.direction,
        moving: path.moving,
      };
    }
  }
  if (anchor) return { status: "keyframeHold", x: anchor.x, z: anchor.z };
  if (event?.kind === "return" && event.x !== undefined)
    return { status: "returnAnchor", x: event.x, z: event.z };
  return { status: "missing" };
}

const sourceByStatus = {
  moving: "waypoint",
  waypointStationary: "waypoint",
  keyframe: "keyframe",
  keyframeHold: "keyframe-hold",
  returnAnchor: "return",
};

/** Sample decoded champion evidence at an absolute time, independent of seek history. */
export function sampleNativeTerrainMotion(motion, timeSeconds) {
  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    timeSeconds > motion.durationSeconds
  )
    throw Error("Champion motion sample time is outside the recorded replay");
  const coverage = {
    verifiedParticipants: motion.tracks.length,
    unresolvedParticipants: motion.unresolvedParticipants,
    moving: 0,
    waypointStationary: 0,
    keyframe: 0,
    keyframeHold: 0,
    returnAnchor: 0,
    dead: 0,
    missing: 0,
  };
  const markers = [];
  for (const track of motion.tracks) {
    const {
      status,
      x,
      z,
      direction = null,
      moving = false,
    } = sampleTrack(track, timeSeconds);
    coverage[status]++;
    if (status === "dead" || status === "missing") continue;
    markers.push({
      participantId: track.participantId,
      x,
      z,
      moving,
      direction,
      source: sourceByStatus[status],
    });
  }
  return { timeSeconds, markers, coverage };
}
