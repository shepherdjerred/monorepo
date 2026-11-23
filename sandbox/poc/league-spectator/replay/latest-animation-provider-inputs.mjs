import { COMBAT_STATS_SHA } from "./latest-combat-stats.mjs";

const order = (left, right) =>
  left.time - right.time ||
  left.transportSequence - right.transportSequence ||
  left.recordIndex - right.recordIndex;
function ordinal(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// This provider exposes observed replicated-computed MoveSpeed at an explicit
// replay cursor. It does not choose a native frame schedule, fabricate defaults,
// or stand in for the separate HasBuff/Homeguard providers.
export function createLatestAnimationMoveSpeedProvider(report) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    report.combatStatPackageSha256 !== COMBAT_STATS_SHA ||
    !Array.isArray(report.combatStatUpdates) ||
    !Array.isArray(report.heroes) ||
    !Number.isFinite(report.endTime) ||
    report.endTime < 0
  )
    throw Error("Exact observed combat-stat animation input required");
  const endTime = report.endTime;
  const tracks = new Map();
  for (const hero of report.heroes) {
    if (
      !Number.isSafeInteger(hero.entityId) ||
      hero.entityId <= 0 ||
      hero.entityId > 0xffffffff ||
      tracks.has(hero.entityId)
    )
      throw Error("Unique original hero identities required");
    tracks.set(hero.entityId, []);
  }
  for (const row of report.combatStatUpdates) {
    if (!Object.hasOwn(row, "moveSpeed")) continue;
    if (
      !tracks.has(row.entityId) ||
      !Number.isFinite(row.time) ||
      row.time < 0 ||
      row.time > endTime ||
      !ordinal(row.transportSequence) ||
      !ordinal(row.recordIndex) ||
      !Number.isFinite(row.moveSpeed) ||
      Math.fround(row.moveSpeed) !== row.moveSpeed
    )
      throw Error(
        "Original finite float32 MoveSpeed observation/cursor required",
      );
    tracks
      .get(row.entityId)
      .push({
        value: row.moveSpeed,
        time: row.time,
        transportSequence: row.transportSequence,
        recordIndex: row.recordIndex,
      });
  }
  for (const track of tracks.values()) {
    track.sort(order);
    for (let index = 1; index < track.length; index++)
      if (order(track[index - 1], track[index]) === 0)
        throw Error("Duplicate original MoveSpeed observation cursor");
  }
  return Object.freeze({
    sample(entityId, time, cursor = null) {
      if (
        !tracks.has(entityId) ||
        !Number.isFinite(time) ||
        time < 0 ||
        time > endTime ||
        (cursor !== null &&
          (!cursor ||
            !ordinal(cursor.transportSequence) ||
            !ordinal(cursor.recordIndex) ||
            (cursor.exclusive !== undefined &&
              typeof cursor.exclusive !== "boolean")))
      )
        throw Error(
          "Observed MoveSpeed query requires a valid hero/time/cursor",
        );
      const track = tracks.get(entityId);
      let low = 0,
        high = track.length;
      while (low < high) {
        const middle = (low + high) >>> 1,
          row = track[middle];
        const cursorOrder =
          cursor === null
            ? 0
            : row.transportSequence - cursor.transportSequence ||
              row.recordIndex - cursor.recordIndex;
        const before =
          row.time < time ||
          (row.time === time &&
            (cursor === null ||
              (cursor.exclusive ? cursorOrder < 0 : cursorOrder <= 0)));
        if (before) low = middle + 1;
        else high = middle;
      }
      if (!low)
        return { status: "unavailable", reason: "no-recorded-computed-stat" };
      const { value, ...provenance } = track[low - 1];
      return { status: "observed", value, provenance };
    },
    describe() {
      return {
        kind: "observed-replicated-computed-animation-move-speed",
        combatStatPackageSha256: COMBAT_STATS_SHA,
        beforeFirstObservation: "unavailable",
        nativeFrameSchedulingEstablished: false,
        nativeGraphInputsAdmitted: false,
        firstObserved: Object.fromEntries(
          [...tracks].map(([entityId, track]) => [
            entityId,
            track.length ? { ...track[0] } : null,
          ]),
        ),
      };
    },
  });
}
