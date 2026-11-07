export const PLAYER_START = 0x400000ae;

export function indexMovement(events) {
  const tracks = new Map();
  for (const event of events) {
    if (!tracks.has(event.entityId)) tracks.set(event.entityId, []);
    tracks.get(event.entityId).push(event);
  }
  return tracks;
}

// Absolute-time evaluation makes scrubbing independent of render frame rate.
export function sampleMovement(track, time) {
  if (!track?.length || time < track[0].time) return null;
  let lo = 0,
    hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (track[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  const event = track[lo - 1];
  let distance = Math.max(0, time - event.time) * event.speed;
  let point = event.waypoints[0],
    direction = [0, 1];
  for (let i = 1; i < event.waypoints.length; i++) {
    const target = event.waypoints[i];
    const dx = target[0] - point[0],
      dz = target[1] - point[1];
    const length = Math.hypot(dx, dz);
    if (length) direction = [dx / length, dz / length];
    if (distance < length)
      return {
        point: [
          point[0] + direction[0] * distance,
          point[1] + direction[1] * distance,
        ],
        direction,
        moving: event.speed > 0,
        event,
      };
    distance -= length;
    point = target;
  }
  return { point, direction, moving: false, event };
}
