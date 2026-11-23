import { expect, test } from "bun:test";
import { createLatestViewerPoseEventIndex } from "./latest-viewer-pose-event-index.mjs";

const eventOrdinal = (event) => {
  const source = event.sourceEvent ?? event;
  return {
    transportSequence: event.transportSequence ?? source.transportSequence,
    entryOrder: event.entryOrder ?? source.entryOrder,
  };
};
const packet = (event) =>
  Number.isSafeInteger(eventOrdinal(event).transportSequence) &&
  eventOrdinal(event).transportSequence >= 0;
const ordinal = (event) =>
  packet(event) &&
  Number.isSafeInteger(eventOrdinal(event).entryOrder) &&
  eventOrdinal(event).entryOrder >= 0;
const causalTieOrder = (a, b) => {
  if (!packet(a) || !packet(b)) return null;
  const x = eventOrdinal(a),
    y = eventOrdinal(b);
  return x.transportSequence !== y.transportSequence
    ? x.transportSequence - y.transportSequence
    : ordinal(a) && ordinal(b)
      ? x.entryOrder - y.entryOrder
      : null;
};
function baseline(events, plan, time, cursor) {
  const admitted = [];
  for (const event of events) {
    if (event.time > time) break;
    if (event.time === time && cursor !== null) {
      const ordinal = eventOrdinal(event);
      if (
        !Number.isSafeInteger(ordinal.transportSequence) ||
        ordinal.transportSequence < 0 ||
        (ordinal.transportSequence === cursor.transportSequence &&
          (!Number.isSafeInteger(ordinal.entryOrder) || ordinal.entryOrder < 0))
      )
        return {
          resolved: false,
          reasons: ["pose:same-time-animation-causal-ordinal-unresolved"],
        };
      if (
        ordinal.transportSequence > cursor.transportSequence ||
        (ordinal.transportSequence === cursor.transportSequence &&
          (ordinal.entryOrder > cursor.entryOrder ||
            (cursor.exclusive === true &&
              ordinal.entryOrder === cursor.entryOrder)))
      )
        continue;
    }
    admitted.push(event);
  }
  for (let index = 1; index < admitted.length; index++)
    if (
      admitted[index].time === admitted[index - 1].time &&
      causalTieOrder(admitted[index], admitted[index - 1]) === null
    )
      return { resolved: false, reasons: ["pose:animation-order-unresolved"] };
  const ownership = new Map();
  for (const event of admitted)
    for (const track of plan.tracks.get(event)) ownership.set(track, event);
  return { resolved: true, ownership };
}
const plansFor = (events, tracks) =>
  [false, true].map((moving) => ({
    tracks: new Map(
      events.map((event, index) => [event, tracks(event, index, moving)]),
    ),
  }));
function compare(events, plans, queries) {
  const index = createLatestViewerPoseEventIndex({
    events,
    plans,
    eventOrdinal,
    causalTieOrder,
  });
  for (const [time, cursor] of queries)
    for (let plan = 0; plan < plans.length; plan++) {
      const expected = baseline(events, plans[plan], time, cursor),
        actual = index.select(plan, time, cursor);
      expect(actual).toEqual(expected);
      if (actual.resolved) {
        expect([...actual.ownership.keys()]).toEqual([
          ...expected.ownership.keys(),
        ]);
        for (const [key, event] of actual.ownership)
          expect(event).toBe(expected.ownership.get(key));
      }
    }
  return index;
}

test("long absolute track queries preserve complete prefix ownership and insertion order across forward/backward cutoffs", () => {
  const events = Array.from({ length: 5000 }, (_, index) => ({
    time: Math.floor(index / 3) / 60,
    sequence: index,
    transportSequence: Math.floor(index / 2),
    entryOrder: index % 2,
    rate: index % 19 === 0 ? 0 : 1,
  }));
  const plans = plansFor(events, (_, index, moving) => [
    index % (moving ? 9 : 7),
    `shared:${index % 3}`,
  ]);
  const queries = [
    [-1, null],
    [100, null],
  ];
  for (let slot = 0; slot < events.length; slot += 71) {
    const event = events[slot],
      cursor = {
        transportSequence: event.transportSequence,
        entryOrder: event.entryOrder,
      };
    queries.push(
      [event.time, null],
      [event.time, cursor],
      [event.time, { ...cursor, exclusive: true }],
      [event.time + 1 / 120, cursor],
    );
  }
  compare(events, plans, [...queries, ...queries.toReversed()]);
});

test("same-clock ambiguity gates retain causal validation precedence and filtered adjacency", () => {
  const events = [
    { time: 1, sequence: 1, transportSequence: 10, entryOrder: 0 },
    { time: 1, sequence: 2, transportSequence: 20 },
    { time: 1, sequence: 3, transportSequence: 20, entryOrder: 1 },
    { time: 2, sequence: 4 },
  ];
  const plans = plansFor(events, (_, index) => [index % 2]);
  compare(events, plans, [
    [0, null],
    [1, null],
    [1, { transportSequence: 10, entryOrder: 0 }],
    [1, { transportSequence: 20, entryOrder: 0 }],
    [1, { transportSequence: 30, entryOrder: 0 }],
    [1.5, null],
    [2, { transportSequence: 50, entryOrder: 0 }],
    [3, null],
    [1, { transportSequence: 10, entryOrder: 0, exclusive: true }],
  ]);
});

test("first admitted track insertion and rate-zero owners are preserved rather than restoring a prior clip", () => {
  const events = [
    { time: 1, sequence: 1, transportSequence: 3, entryOrder: 0, rate: 1 },
    { time: 1, sequence: 2, transportSequence: 1, entryOrder: 0, rate: 0 },
    { time: 1, sequence: 3, transportSequence: 1, entryOrder: 1, rate: 1 },
    {
      time: 2,
      sequence: 4,
      sourceEvent: { transportSequence: 5, entryOrder: 0 },
      rate: 0,
    },
  ];
  const plans = plansFor(
    events,
    (_, index) => [["a"], ["b", "a", "b"], ["c"], ["a"]][index],
  );
  const index = compare(events, plans, [
    [1, { transportSequence: 1, entryOrder: 1 }],
    [1, null],
    [2, null],
    [0, null],
  ]);
  expect([
    ...index
      .select(0, 1, { transportSequence: 1, entryOrder: 1 })
      .ownership.keys(),
  ]).toEqual(["b", "a", "c"]);
  expect(index.select(0, 2, null).ownership.get("a").rate).toBe(0);
});
