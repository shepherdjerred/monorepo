import { test, expect } from "bun:test";
import {
  createPresentationObservationOrder,
  validatePresentationObservationOrder,
  createDiagnosticFrameLookup,
} from "./latest-spectator-observation-order.mjs";

test("coarsened draw/tick ties keep exact completion and observation order", () => {
  const next = createPresentationObservationOrder();
  const boundary = { drawId: 10, drawOrder: next(), drawWallTime: 5 };
  const oldTick = { ...boundary, observationOrder: next(), wallTime: 10 };
  const first = { drawId: 11, drawOrder: next(), drawWallTime: 10 };
  const firstTick = { ...first, observationOrder: next(), wallTime: 10 };
  const second = { drawId: 12, drawOrder: next(), drawWallTime: 10 };
  const secondTick = { ...second, observationOrder: next(), wallTime: 10 };
  const frames = [first, second],
    ticks = [oldTick, firstTick, secondTick];
  const raw = structuredClone({ frames, ticks, boundary });
  expect(() =>
    validatePresentationObservationOrder(frames, ticks, boundary),
  ).not.toThrow();
  expect({ frames, ticks, boundary }).toEqual(raw);
  // A later draw shares the old tick's clock sample but was not yet completed.
  expect(() =>
    validatePresentationObservationOrder(
      frames,
      [
        { ...oldTick, drawId: first.drawId, drawOrder: first.drawOrder },
        firstTick,
        secondTick,
      ],
      boundary,
    ),
  ).toThrow();
  // Conversely, retaining an older stamp after the newer completion is false.
  expect(() =>
    validatePresentationObservationOrder(
      frames,
      [
        oldTick,
        {
          ...firstTick,
          drawId: boundary.drawId,
          drawOrder: boundary.drawOrder,
        },
        secondTick,
      ],
      boundary,
    ),
  ).toThrow();
});

test("duplicate/colliding orders, clock regressions and changed completion ownership reject", () => {
  const frame = { drawId: 3, drawOrder: 2, drawWallTime: 20 };
  const tick = { ...frame, observationOrder: 3, wallTime: 20 };
  for (const patch of [
    { observationOrder: frame.drawOrder },
    { observationOrder: 0 },
    { observationOrder: 2.5 },
    { drawOrder: 1 },
    { drawId: 4 },
    { wallTime: 19.99 },
  ])
    expect(() =>
      validatePresentationObservationOrder(
        [frame],
        [{ ...tick, ...patch }],
        null,
      ),
    ).toThrow();
  expect(() =>
    validatePresentationObservationOrder(
      [frame, { ...frame, drawId: 4 }],
      [tick],
      null,
    ),
  ).toThrow();
  expect(() =>
    validatePresentationObservationOrder([frame], [tick, tick], null),
  ).toThrow();
  const later = { drawId: 4, drawOrder: 3, drawWallTime: 20 };
  expect(() =>
    validatePresentationObservationOrder([frame, later], [tick], null),
  ).toThrow();
});

test("draw identity keeps tied GPU frames separate; timestamp-only ambiguity is explicit", () => {
  const first = { drawId: 8, wallTime: 100, replayTime: 70 };
  const second = { drawId: 9, wallTime: 100, replayTime: 70 };
  const lookup = createDiagnosticFrameLookup([first, second], true);
  expect(lookup({ drawId: 8, wallTime: 100 }).frame).toBe(first);
  expect(lookup({ drawId: 9, wallTime: 100 }).frame).toBe(second);
  expect(lookup({ wallTime: 100 })).toEqual({ frame: null, ambiguous: false });
  expect(lookup({ drawId: 10, wallTime: 100 }).frame).toBeNull();
  expect(() =>
    createDiagnosticFrameLookup([first, { ...second, drawId: 8 }], true),
  ).toThrow();
  expect(
    createDiagnosticFrameLookup([first, second], false)({ wallTime: 100 }),
  ).toEqual({ frame: null, ambiguous: true });
  expect(
    createDiagnosticFrameLookup([first], false)({ wallTime: 100 }).frame,
  ).toBe(first);
});
