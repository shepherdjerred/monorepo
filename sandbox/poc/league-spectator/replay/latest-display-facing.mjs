import { sampleMovement } from "./playback.mjs";

export const DISPLAY_FACING_POLICY = "causal-last-movement-display-facing-v1";
const observations = new WeakSet();
const freeze = (value) => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const validTime = (time) => Number.isFinite(time) && time >= 0;
const ordinal = (event) => {
  if (
    !Number.isSafeInteger(event.transportSequence) ||
    event.transportSequence < 0 ||
    !Number.isSafeInteger(event.entryOrder ?? 0) ||
    (event.entryOrder ?? 0) < 0
  )
    throw Error("Causal display facing requires original packet ordinals");
  return [event.transportSequence, event.entryOrder ?? 0];
};
const order = (a, b) => {
  if (a.time !== b.time) return a.time - b.time;
  const x = ordinal(a),
    y = ordinal(b);
  return x[0] - y[0] || x[1] - y[1];
};
const included = (event, time, cursor) => {
  if (event.time !== time || cursor === null) return event.time <= time;
  const x = ordinal(event),
    delta = x[0] - cursor.transportSequence || x[1] - cursor.entryOrder;
  return cursor.exclusive ? delta < 0 : delta <= 0;
};
const last = (events, time, cursor, event = (row) => row) => {
  let low = 0,
    high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (included(event(events[middle]), time, cursor)) low = middle + 1;
    else high = middle;
  }
  return low - 1;
};
const hasDirection = (event) =>
  event.waypoints.some(
    (point, i) =>
      i > 0 &&
      Math.hypot(
        point[0] - event.waypoints[i - 1][0],
        point[1] - event.waypoints[i - 1][1],
      ) > 0,
  );

// This owns accepted movement/lifecycle copies. It never reads rendered transforms
// and never supplies orientation to world attachment or projectile queries.
export function createLatestDisplayFacing({ movement, lifecycle, heroes }) {
  if (
    !(movement instanceof Map) ||
    !(lifecycle instanceof Map) ||
    !Array.isArray(heroes)
  )
    throw Error(
      "Accepted movement, lifecycle and hero creation tracks required",
    );
  const tracks = new Map();
  for (const hero of heroes) {
    if (
      !Number.isInteger(hero.entityId) ||
      hero.entityId <= 0 ||
      hero.entityId > 0xffffffff ||
      tracks.has(hero.entityId) ||
      !validTime(hero.provenance?.time)
    )
      throw Error("Valid unique display hero creation required");
    const events = structuredClone(movement.get(hero.entityId) ?? []).filter(
      (event) => event.source !== "initial-hero-creation",
    );
    const previousDirection = [];
    let previous = -1;
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (
        event.entityId !== hero.entityId ||
        !Number.isFinite(event.time) ||
        event.time < 0 ||
        !Number.isFinite(event.speed) ||
        event.speed < 0 ||
        !Array.isArray(event.waypoints) ||
        !event.waypoints.length ||
        event.waypoints.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every(Number.isFinite),
        )
      )
        throw Error("Invalid accepted display movement input");
      ordinal(event);
      if (i && order(events[i - 1], event) > 0)
        throw Error("Unordered accepted display movement input");
      if (hasDirection(event)) previous = i;
      previousDirection.push(previous);
    }
    const creation = {
      entityId: hero.entityId,
      time: hero.provenance.time,
      transportSequence: hero.provenance.transportSequence,
      entryOrder: hero.provenance.entryOrder ?? 0,
      kind: "hero-creation",
    };
    ordinal(creation);
    const intervals = structuredClone(lifecycle.get(hero.entityId) ?? []),
      resets = [
        creation,
        ...intervals.flatMap((row) => (row.respawn ? [row.respawn] : [])),
      ].sort(order);
    for (let i = 0; i < intervals.length; i++) {
      const { death, respawn } = intervals[i];
      if (!death || !validTime(death.time) || death.entityId !== hero.entityId)
        throw Error("Valid display death input required");
      ordinal(death);
      if (i && order(intervals[i - 1].death, death) >= 0)
        throw Error("Ordered display death inputs required");
      if (respawn) {
        if (
          !validTime(respawn.time) ||
          respawn.entityId !== hero.entityId ||
          order(death, respawn) >= 0
        )
          throw Error("Valid ordered display respawn input required");
        ordinal(respawn);
      }
    }
    tracks.set(hero.entityId, { events, previousDirection, intervals, resets });
  }
  return Object.freeze({
    sample(entityId, time, cursor = null) {
      if (!Number.isFinite(time) || time < 0)
        throw Error("Absolute display facing time required");
      if (cursor !== null) {
        ordinal(cursor);
        if (
          cursor.exclusive !== undefined &&
          typeof cursor.exclusive !== "boolean"
        )
          throw Error("Boolean display cursor exclusion required");
      }
      const track = tracks.get(entityId);
      if (!track) throw Error("Registered display actor required");
      const intervalIndex = last(
          track.intervals,
          time,
          cursor,
          (row) => row.death,
        ),
        interval = intervalIndex < 0 ? null : track.intervals[intervalIndex],
        dead =
          interval &&
          (!interval.respawn || !included(interval.respawn, time, cursor)),
        sampledTime = dead ? interval.death.time : time,
        sampledCursor = dead
          ? {
              transportSequence: interval.death.transportSequence,
              entryOrder: interval.death.entryOrder ?? 0,
            }
          : cursor,
        current = last(track.events, sampledTime, sampledCursor),
        sourceIndex = current < 0 ? -1 : track.previousDirection[current],
        resetIndex = last(track.resets, sampledTime, sampledCursor),
        reset = resetIndex < 0 ? null : track.resets[resetIndex],
        source = sourceIndex < 0 ? null : track.events[sourceIndex];
      const known =
        reset !== null && source !== null && order(source, reset) > 0;
      const interruption =
        known && current > sourceIndex ? track.events[sourceIndex + 1] : null;
      const sampleTime = interruption ? interruption.time : sampledTime,
        direction = known
          ? sampleMovement([source], sampleTime).direction
          : null;
      const result = {
        policy: DISPLAY_FACING_POLICY,
        entityId,
        time,
        cursor: structuredClone(cursor),
        displayOnly: true,
        nativeAcceptance: null,
        worldAttachmentResolved: false,
        status: known ? "causal-movement-preview" : "authored-bind-preview",
        direction: direction ? [...direction] : null,
        sampledTime: sampleTime,
        source: known ? structuredClone(source) : null,
        interruption: interruption ? structuredClone(interruption) : null,
        reset: reset ? structuredClone(reset) : null,
        frozenAtDeath: dead ? structuredClone(interval.death) : null,
        omissions: [
          known
            ? "display-facing:retained-causal-movement-preview"
            : "display-facing:authored-bind-rotation-unresolved-facing",
        ],
      };
      freeze(result);
      observations.add(result);
      return result;
    },
  });
}

export function assertLatestDisplayFacing(value, entityId, time) {
  if (
    !observations.has(value) ||
    value.entityId !== entityId ||
    value.time !== time
  )
    throw Error("Owned same-time display facing observation required");
  return value;
}
