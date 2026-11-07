// Exact-build movement ordering and path candidates. Motion heights, collision,
// acceleration and actor/controller state remain separate research work.
export function latestMovementOrigin(min, max) {
  // 16.21 x64 navgrid initialization, RVA 0x16b6f6c..0x16b6fc9:
  // addss bounds, cvttss2si, signed 16-bit integer division by two.
  return [0, 2].map((axis) => {
    const sum = Math.trunc(
      Math.fround(Math.fround(min[axis]) + Math.fround(max[axis])),
    );
    if (!Number.isFinite(sum) || sum < -32768 || sum > 32767)
      throw Error("Navgrid bounds exceed the supported movement origin domain");
    return Math.trunc(sum / 2);
  });
}

export function prepareLatestMovement(report, map) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e"
  )
    throw Error("Wrong movement reconstruction build");
  const origin = latestMovementOrigin(map.min, map.max);
  if (origin.some((value, axis) => value !== map.movementOrigin[axis]))
    throw Error(
      "Static movement origin disagrees with exact-build quantization",
    );
  const tracks = new Map(),
    syncIds = new Map(),
    rejected = [];
  const append = (event) => {
    if (!tracks.has(event.entityId)) tracks.set(event.entityId, []);
    tracks.get(event.entityId).push(event);
  };
  for (const hero of report.heroes)
    append({
      entityId: hero.entityId,
      time: 0,
      sequence: -1,
      speed: 0,
      waypoints: [[hero.creationPosition[0], hero.creationPosition[2]]],
      source: "initial-hero-creation",
    });
  let accepted = 0,
    motionRecords = 0;
  const records = [...report.movement].sort(
    (a, b) => a.time - b.time || a.sequence - b.sequence,
  );
  for (const record of records) {
    if (
      !Number.isInteger(record.syncId) ||
      record.syncId < 0 ||
      record.syncId > 0xffffffff
    )
      throw Error("Missing movement synchronization identifier");
    const previous = syncIds.get(record.entityId) ?? 0;
    // Native 0x1a2140, called with mode zero by both packet handlers. Preserve
    // signed comparisons and 32-bit subtraction, including its wrap threshold.
    if (
      (previous | 0) > (record.syncId | 0) &&
      ((previous - record.syncId) | 0) < 0x40000000
    ) {
      rejected.push({
        entityId: record.entityId,
        time: record.time,
        sequence: record.sequence,
        syncId: record.syncId,
        previous,
        reason: "Native movement synchronization rejected an older update",
      });
      continue;
    }
    syncIds.set(record.entityId, record.syncId);
    const speed = record.motion ? record.motion.speed : record.speed;
    if (!Number.isFinite(speed) || speed < 0)
      throw Error("Invalid movement candidate speed");
    append({
      ...record,
      speed,
      headerSpeed: record.speed,
      source: record.motion ? "motion-path" : "waypoint-path",
      waypoints: record.encodedWaypoints.map(([x, z]) => [
        x * 2 + origin[0],
        z * 2 + origin[1],
      ]),
    });
    accepted++;
    if (record.motion) motionRecords++;
  }
  return {
    tracks,
    rejected,
    summary: { accepted, rejected: rejected.length, motionRecords },
    origin,
  };
}
