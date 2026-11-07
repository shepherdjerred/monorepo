import { expect, test } from "bun:test";
import {
  createLatestDisplayFacing,
  assertLatestDisplayFacing,
} from "./latest-display-facing.mjs";

const event = (time, transportSequence, waypoints, entryOrder = 0) => ({
  entityId: 1,
  time,
  transportSequence,
  entryOrder,
  sequence: transportSequence,
  speed: 10,
  waypoints,
  source: "waypoint-path",
});
const hero = { entityId: 1, provenance: { time: 0, transportSequence: 1 } };
const make = (events, intervals = [], heroes = [hero]) =>
  createLatestDisplayFacing({
    movement: new Map([[1, events]]),
    lifecycle: new Map([[1, intervals]]),
    heroes,
  });

test("display facing stops at the first causal interruption and ignores later/future state", () => {
  const source = event(1, 2, [
      [0, 0],
      [10, 0],
      [10, 10],
    ]),
    stop = event(1.5, 3, [[5, 0]]),
    service = make([
      source,
      stop,
      event(1.8, 4, [[5, 0]]),
      event(5, 5, [
        [0, 0],
        [0, -10],
      ]),
    ]);
  const first = service.sample(1, 3);
  expect(first.direction).toEqual([1, 0]);
  expect(first.sampledTime).toBe(1.5);
  expect(first.interruption.transportSequence).toBe(3);
  service.sample(1, 7);
  service.sample(1, 0);
  expect(service.sample(1, 3)).toEqual(first);
  source.waypoints[1][0] = 100;
  expect(service.sample(1, 3)).toEqual(first);
});

test("same-time inclusive/exclusive packet entry cursors retain exact movement ordering", () => {
  const service = make([
    event(0.5, 2, [
      [0, 0],
      [0, 10],
    ]),
    event(
      1.5,
      10,
      [
        [0, 0],
        [10, 0],
      ],
      0,
    ),
    event(1.5, 10, [[0, 0]], 1),
    event(
      1.5,
      10,
      [
        [0, 0],
        [-10, 0],
      ],
      2,
    ),
  ]);
  expect(
    service.sample(1, 1.5, {
      transportSequence: 10,
      entryOrder: 0,
      exclusive: true,
    }).direction,
  ).toEqual([0, 1]);
  expect(
    service.sample(1, 1.5, { transportSequence: 10, entryOrder: 0 }).direction,
  ).toEqual([1, 0]);
  const stopped = service.sample(1, 1.5, {
    transportSequence: 10,
    entryOrder: 1,
  });
  expect(stopped.direction).toEqual([1, 0]);
  expect(stopped.interruption.entryOrder).toBe(1);
  expect(service.sample(1, 1.5).direction).toEqual([-1, 0]);
});

test("creation/death/respawn boundaries use recorded causal resets without inheriting prior facing", () => {
  const death = { entityId: 1, time: 2, transportSequence: 20, sequence: 20 },
    respawn = { entityId: 1, time: 4, transportSequence: 40, sequence: 40 },
    service = make(
      [
        event(1, 2, [
          [0, 0],
          [10, 0],
        ]),
        event(3, 30, [
          [0, 0],
          [0, -10],
        ]),
        event(4.5, 50, [
          [0, 0],
          [0, 10],
        ]),
      ],
      [{ death, respawn }],
    );
  expect(service.sample(1, 0).status).toBe("authored-bind-preview");
  expect(service.sample(1, 3).direction).toEqual([1, 0]);
  expect(service.sample(1, 3).frozenAtDeath).toEqual(death);
  expect(service.sample(1, 4).direction).toBeNull();
  expect(service.sample(1, 4).reset).toEqual(respawn);
  expect(service.sample(1, 5).direction).toEqual([0, 1]);
  expect(service.sample(1, 1).direction).toEqual([1, 0]);
});

test("owned display observations are deeply immutable, same-time and never attachment capabilities", () => {
  const value = make([
    event(1, 2, [
      [0, 0],
      [10, 0],
    ]),
  ]).sample(1, 1.5, { transportSequence: 3, entryOrder: 0 });
  expect(() => {
    value.direction[0] = NaN;
  }).toThrow();
  expect(() => {
    value.source.waypoints[0][0] = 99;
  }).toThrow();
  expect(() => {
    value.cursor.exclusive = true;
  }).toThrow();
  expect(value.worldAttachmentResolved).toBe(false);
  expect(value.nativeAcceptance).toBeNull();
  expect(assertLatestDisplayFacing(value, 1, 1.5)).toBe(value);
  expect(() => assertLatestDisplayFacing({ ...value }, 1, 1.5)).toThrow(
    "Owned same-time",
  );
  expect(() => assertLatestDisplayFacing(value, 1, 2)).toThrow(
    "Owned same-time",
  );
});

test("corrupt clocks/reset ordinals and nonboolean cursors fail at the producer boundary", () => {
  expect(() => make([event(NaN, 2, [[0, 0]])])).toThrow();
  expect(() =>
    make(
      [],
      [],
      [{ ...hero, provenance: { ...hero.provenance, time: Infinity } }],
    ),
  ).toThrow();
  expect(() =>
    make([], [{ death: { entityId: 1, time: NaN, transportSequence: 2 } }]),
  ).toThrow();
  expect(() =>
    make(
      [],
      [
        {
          death: { entityId: 1, time: 2, transportSequence: 2 },
          respawn: { entityId: 1, time: 1, transportSequence: 3 },
        },
      ],
    ),
  ).toThrow();
  expect(() =>
    make([]).sample(1, 0, {
      transportSequence: 1,
      entryOrder: 0,
      exclusive: "false",
    }),
  ).toThrow();
});
