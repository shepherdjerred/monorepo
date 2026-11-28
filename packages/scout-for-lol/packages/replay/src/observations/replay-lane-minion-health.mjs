// AIMinionClient registers Current and Max HP as group 8 float fields 0 and 1
// in .8428. Callers supply exact-build packets and authenticated lane lives.
export const laneMinionHealthGroup = 8;

export function readLaneMinionHealthPrefix(fieldMask, bytes) {
  const values = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  for (const [index, field] of ["current", "max"].entries()) {
    if ((fieldMask & (1 << index)) === 0) continue;
    const marker = bytes[offset];
    if (marker === 0xff) {
      offset++;
      values[field] = 0;
      continue;
    }
    if (marker === 0xfe) offset++;
    if (offset + 4 > bytes.length)
      throw Error("Truncated lane-minion health field");
    const value = view.getFloat32(offset, true);
    if (!Number.isFinite(value) || value < 0)
      throw Error("Invalid lane-minion health field");
    values[field] = value;
    offset += 4;
  }
  return { values, prefixBytes: offset };
}

function trackLife({
  context,
  creationTimeSeconds,
  killTimeSeconds,
  removalTimeSeconds,
}) {
  if (!Number.isSafeInteger(context) || context < 1 || context > 0xffffffff)
    throw Error("Invalid lane-minion context");
  if (!Number.isFinite(creationTimeSeconds) || creationTimeSeconds < 0)
    throw Error("Invalid lane-minion birth clock");
  if (killTimeSeconds == null || removalTimeSeconds == null) return null;
  if (
    !Number.isFinite(killTimeSeconds) ||
    !Number.isFinite(removalTimeSeconds) ||
    killTimeSeconds <= creationTimeSeconds ||
    removalTimeSeconds < killTimeSeconds
  )
    throw Error("Invalid lane-minion life bounds");
  return {
    context,
    start: creationTimeSeconds,
    end: killTimeSeconds,
    points: [],
    values: {},
  };
}

export function foldRecordedLaneMinionHealth(instances, groups) {
  const tracks = new Map();
  const seen = new Set();
  for (const instance of instances) {
    const track = trackLife(instance);
    if (seen.has(instance.context))
      throw Error("Duplicate lane-minion context");
    seen.add(instance.context);
    if (track !== null) tracks.set(track.context, track);
  }
  for (const {
    participantId,
    stream,
    group,
    fieldMask,
    timeSeconds,
    bytes,
  } of groups) {
    const track = tracks.get(participantId);
    if (
      !track ||
      stream !== 1 ||
      group !== laneMinionHealthGroup ||
      !(fieldMask & 3)
    )
      continue;
    if (!Number.isFinite(timeSeconds))
      throw Error("Invalid lane-minion health clock");
    if (timeSeconds < track.start || timeSeconds >= track.end) continue;

    if (track.clock !== undefined && timeSeconds < track.clock)
      throw Error("Lane-minion health observations are out of order");
    track.clock = timeSeconds;
    Object.assign(
      track.values,
      readLaneMinionHealthPrefix(fieldMask, bytes).values,
    );
    const { current, max } = track.values;
    if (current === undefined || !(max > 0)) {
      if (track.points.length > 0)
        throw Error("Lane-minion health lost its recorded maximum");
      continue;
    }
    if (current > max)
      throw Error("Lane-minion health exceeds its recorded maximum");
    const point = [timeSeconds, current, max];
    const last = track.points.at(-1);
    if (last?.[0] === timeSeconds)
      track.points[track.points.length - 1] = point;
    else if (last?.[1] !== current || last?.[2] !== max)
      track.points.push(point);
  }
  return [...tracks.values()]
    .filter(({ points }) => points.length > 0)
    .map(({ context, start, end, points }) => ({
      context,
      start,
      end,
      points,
    }));
}

export function sampleRecordedLaneMinionHealth(
  { start, end, points },
  timeSeconds,
) {
  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < start ||
    timeSeconds >= end
  )
    return undefined;
  let left = 0;
  let right = points.length;
  while (left < right) {
    const middle = left + Math.floor((right - left) / 2);
    if (points[middle][0] <= timeSeconds) left = middle + 1;
    else right = middle;
  }
  if (left === 0) return undefined;
  const [, current, max] = points[left - 1];
  return { current, max };
}
