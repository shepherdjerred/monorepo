import { prepareLatestMovement } from "./latest-movement.mjs";
import { sampleMovement } from "./playback.mjs";

const owners = new WeakMap();
const metadata = (event) => ({
  entityId: event.entityId,
  time: event.time,
  sequence: event.sequence,
  transportSequence: event.transportSequence,
  entryOrder: event.entryOrder,
  speed: event.speed,
  source: event.source,
});
const mapIdentity = (map) =>
  JSON.stringify([map.min, map.max, map.movementOrigin]);

// One private accepted path index per renderer session. Hot numeric arrays never
// escape; each sample owns its output. The original public reconstruction API
// remains unchanged for tools which need the complete accepted packet records.
export function createOwnedLatestMovement(report, map) {
  const prepared = prepareLatestMovement(report, map);
  const tracks = new Map();
  for (const [entityId, rows] of prepared.tracks) {
    tracks.set(
      entityId,
      rows.map((event) => ({
        ...metadata(event),
        waypoints: event.waypoints,
      })),
    );
  }
  const creationOrdinals = new Map(
    report.heroes.map((hero) => [
      hero.entityId,
      hero.provenance?.transportSequence,
    ]),
  );
  const owner = Object.freeze({});
  owners.set(owner, {
    report: new WeakRef(report),
    build: report.build,
    protocol: report.protocol,
    replaySha256: report.replaySha256,
    mapIdentity: mapIdentity(map),
    tracks,
    creationOrdinals,
    summary: { ...prepared.summary },
  });
  return owner;
}

export function bindOwnedLatestMovement(
  owner,
  report,
  map,
  { heroCreationOrdinals = false } = {},
) {
  const state = owners.get(owner);
  if (
    !state ||
    state.report.deref() !== report ||
    state.build !== report.build ||
    state.protocol !== report.protocol ||
    state.replaySha256 !== report.replaySha256 ||
    state.mapIdentity !== mapIdentity(map) ||
    typeof heroCreationOrdinals !== "boolean"
  )
    throw Error("Matching owned movement report and map required");
  const { tracks, creationOrdinals } = state;
  const sourceOrdinal = (event) =>
    event.source === "initial-hero-creation" && heroCreationOrdinals
      ? creationOrdinals.get(event.entityId)
      : event.transportSequence;
  return Object.freeze({
    summary: Object.freeze({ ...state.summary }),
    // Display-facing owns copies of only its ten hero tracks, rather than a
    // second full-match movement index. This also keeps its validation intact.
    copyHeroTracks(entityIds) {
      return new Map(
        entityIds.map((id) => [id, structuredClone(tracks.get(id) ?? [])]),
      );
    },
    sample(entityId, time, cursor = null) {
      if (
        cursor !== null &&
        (!cursor ||
          !Number.isSafeInteger(cursor.transportSequence) ||
          cursor.transportSequence < 0 ||
          !Number.isSafeInteger(cursor.entryOrder) ||
          cursor.entryOrder < 0 ||
          (cursor.exclusive !== undefined &&
            typeof cursor.exclusive !== "boolean"))
      )
        throw Error("Ordered world query requires original packet ordinals");
      const rows = tracks.get(entityId);
      let lo = 0,
        hi = rows?.length ?? 0;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1,
          event = rows[mid];
        let included = event.time <= time;
        if (cursor && event.time === time) {
          const transportSequence = sourceOrdinal(event),
            entryOrder = event.entryOrder ?? 0;
          if (
            !Number.isSafeInteger(transportSequence) ||
            transportSequence < 0 ||
            !Number.isSafeInteger(entryOrder) ||
            entryOrder < 0
          )
            throw Error(
              "Ordered world query requires original packet ordinals",
            );
          const order =
            transportSequence - cursor.transportSequence ||
            entryOrder - cursor.entryOrder;
          included = cursor.exclusive ? order < 0 : order <= 0;
        }
        if (included) lo = mid + 1;
        else hi = mid;
      }
      if (!lo) return null;
      const event = rows[lo - 1],
        sample = sampleMovement([event], time);
      return {
        point: [...sample.point],
        direction: sample.direction,
        moving: sample.moving,
        event: { ...metadata(event), transportSequence: sourceOrdinal(event) },
        orientationKnown:
          event.source !== "initial-hero-creation" &&
          event.waypoints.some(
            (point, index) =>
              index > 0 &&
              Math.hypot(
                point[0] - event.waypoints[index - 1][0],
                point[1] - event.waypoints[index - 1][1],
              ) > 0,
          ),
      };
    },
  });
}
