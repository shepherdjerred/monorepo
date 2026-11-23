const ORDER_REASON = "pose:animation-order-unresolved";
const CURSOR_REASON = "pose:same-time-animation-causal-ordinal-unresolved";
const unresolved = (reason) => ({ resolved: false, reasons: [reason] });

function bound(rows, time, upper, event = (row) => row) {
  let low = 0,
    high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1,
      clock = event(rows[middle]).time;
    if (clock < time || (upper && clock === time)) low = middle + 1;
    else high = middle;
  }
  return low;
}

// Events and compiled track ownership belong to the sampler. No interpolation,
// graph clock or clip evaluation occurs here; this indexes the original ordered
// prefix selection, including its ambiguity gates and stable Map insertion order.
export function createLatestViewerPoseEventIndex({
  events,
  plans,
  eventOrdinal,
  causalTieOrder,
}) {
  if (
    !Array.isArray(events) ||
    !Array.isArray(plans) ||
    typeof eventOrdinal !== "function" ||
    typeof causalTieOrder !== "function"
  )
    throw Error("Owned ordered viewer pose events and compiled plans required");
  let firstAmbiguousTime = Infinity;
  for (let index = 1; index < events.length; index++) {
    if (events[index].time < events[index - 1].time)
      throw Error("Viewer pose event clocks moved backwards");
    if (
      events[index].time === events[index - 1].time &&
      causalTieOrder(events[index], events[index - 1]) === null
    )
      firstAmbiguousTime = Math.min(firstAmbiguousTime, events[index].time);
  }
  const indices = plans.map((plan) => {
    if (!(plan.tracks instanceof Map))
      throw Error("Compiled viewer pose track ownership required");
    const tracks = new Map();
    events.forEach((event, eventIndex) => {
      const owned = plan.tracks.get(event);
      if (!Array.isArray(owned))
        throw Error("Compiled viewer pose event tracks missing");
      const seen = new Set();
      owned.forEach((track, slot) => {
        if (seen.has(track)) return;
        seen.add(track);
        if (!tracks.has(track)) tracks.set(track, []);
        tracks.get(track).push({ event, eventIndex, slot });
      });
    });
    return tracks;
  });
  return Object.freeze({
    select(planIndex, time, cursor) {
      const tracks = indices[planIndex];
      if (!tracks || !Number.isFinite(time))
        throw Error("Compiled viewer pose plan and finite clock required");
      const start = bound(events, time, false),
        end = bound(events, time, true);
      const admitted = cursor === null ? null : new Set();
      let previousAtClock = null;
      for (let index = start; index < end; index++) {
        const event = events[index];
        if (cursor !== null) {
          const ordinal = eventOrdinal(event);
          // This precedes the historical ambiguity check in the original
          // sampler, even when that older ambiguity already blocks the prefix.
          if (
            !Number.isSafeInteger(ordinal.transportSequence) ||
            ordinal.transportSequence < 0 ||
            (ordinal.transportSequence === cursor.transportSequence &&
              (!Number.isSafeInteger(ordinal.entryOrder) ||
                ordinal.entryOrder < 0))
          )
            return unresolved(CURSOR_REASON);
          if (
            ordinal.transportSequence > cursor.transportSequence ||
            (ordinal.transportSequence === cursor.transportSequence &&
              (ordinal.entryOrder > cursor.entryOrder ||
                (cursor.exclusive === true &&
                  ordinal.entryOrder === cursor.entryOrder)))
          )
            continue;
          admitted.add(event);
        }
        if (previousAtClock && causalTieOrder(event, previousAtClock) === null)
          previousAtClock = false;
        else if (previousAtClock !== false) previousAtClock = event;
      }
      if (firstAmbiguousTime < time || previousAtClock === false)
        return unresolved(ORDER_REASON);
      const selected = [];
      for (const [track, rows] of tracks) {
        let last = bound(rows, time, true, (row) => row.event) - 1;
        if (cursor !== null)
          while (
            last >= 0 &&
            rows[last].event.time === time &&
            !admitted.has(rows[last].event)
          )
            last--;
        if (last < 0) continue;
        let first = 0;
        if (cursor !== null && rows[0].event.time === time)
          while (!admitted.has(rows[first].event)) first++;
        selected.push({ track, event: rows[last].event, first: rows[first] });
      }
      selected.sort(
        (a, b) =>
          a.first.eventIndex - b.first.eventIndex ||
          a.first.slot - b.first.slot,
      );
      return {
        resolved: true,
        ownership: new Map(selected.map((row) => [row.track, row.event])),
      };
    },
  });
}
