import { expect, test } from "bun:test";
import {
  selectNativeBooleanCondition,
  selectNativeFloatCondition,
} from "./latest-animation-conditions.mjs";

const empty = () => ({
  ordinal: -1,
  remainingSeconds: 0,
  transitioning: false,
});
const pairs = [
  { index: 11, threshold: 0, blendUp: 0.5, blendDown: 0.25 },
  { index: 22, threshold: 350, blendUp: 0.75, blendDown: 0.125 },
];

test("boolean input uses native float32 zero rather than JavaScript truthiness", () => {
  const children = { trueIndex: 11, falseIndex: 22 };
  for (const value of [-0, 0, 1e-50])
    expect(selectNativeBooleanCondition(children, value)).toBe(22);
  for (const value of [-1, 1, 1e-30])
    expect(selectNativeBooleanCondition(children, value)).toBe(11);
  expect(() => selectNativeBooleanCondition(children, undefined)).toThrow(
    "updater value",
  );
  expect(() => selectNativeBooleanCondition(children, NaN)).toThrow(
    "updater value",
  );
});

test("threshold equality and negative inputs preserve the original branch directions", () => {
  expect(selectNativeFloatCondition(pairs, empty(), 349.999).index).toBe(11);
  expect(selectNativeFloatCondition(pairs, empty(), 350).index).toBe(22);
  expect(selectNativeFloatCondition(pairs, empty(), -1).index).toBe(11);
  const negative = [-3, -1, 0].map((threshold, index) => ({
    threshold,
    index,
    blendUp: 0,
    blendDown: 0,
  }));
  expect(selectNativeFloatCondition(negative, empty(), -2).index).toBe(1);
});

test("an outstanding native transition holds its previous child until its delay expires", () => {
  const startup = selectNativeFloatCondition(pairs, empty(), 300),
    initial = selectNativeFloatCondition(pairs, startup.state, 300),
    before = structuredClone(initial.state);
  expect(startup.state.transitioning).toBe(true);
  const changing = selectNativeFloatCondition(pairs, initial.state, 400);
  expect(initial.state).toEqual(before);
  expect(changing).toEqual({
    index: 11,
    state: { ordinal: 0, remainingSeconds: 0.5, transitioning: true },
  });
  const stillWaiting = selectNativeFloatCondition(
    pairs,
    { ...changing.state, remainingSeconds: 0.1 },
    400,
  );
  expect(stillWaiting.index).toBe(11);
  const finished = selectNativeFloatCondition(
    pairs,
    { ...stillWaiting.state, remainingSeconds: 0 },
    400,
  );
  expect(finished.index).toBe(22);
  // A restored prior state reproduces the same transition after a reverse seek.
  expect(
    selectNativeFloatCondition(pairs, structuredClone(before), 400),
  ).toEqual(changing);
});

test("unknown children, nonfinite state and empty conditions fail explicitly", () => {
  expect(() => selectNativeFloatCondition([], empty(), 0)).toThrow(
    "Typed original float",
  );
  expect(() =>
    selectNativeFloatCondition(pairs, { ...empty(), ordinal: 3 }, 0),
  ).toThrow("Typed original float");
  expect(() => selectNativeFloatCondition(pairs, empty(), Infinity)).toThrow(
    "Typed original float",
  );
  expect(() =>
    selectNativeFloatCondition([{ ...pairs[0], index: undefined }], empty(), 1),
  ).toThrow("Typed original float");
});
