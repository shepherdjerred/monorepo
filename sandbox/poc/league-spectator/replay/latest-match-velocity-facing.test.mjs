import { expect, test } from "bun:test";
import { stepPresentationMissileFrame } from "./latest-match-velocity-facing.mjs";
const state = () => ({
  verticalFacingType: "VeritcalFacingMatchVelocity",
  cachedVelocity: [0, 0, 0],
  velocity: [0, 0, 0],
});
test("shared callback retains local integration input and original unequal global-clock velocity", () => {
  const calls = [];
  const frame = {
    step(s, now, delta) {
      calls.push({ type: s.verticalFacingType, now, delta });
      return {
        velocity: [2, 99, 3],
        displacement: [0, 0.00843048095703125, 0],
      };
    },
  };
  const s = state(),
    result = stepPresentationMissileFrame(
      frame,
      s,
      84.40330505371094,
      0.008333333767950535,
      0.01666666753590107,
    );
  expect(calls).toEqual([
    { type: null, now: 84.40330505371094, delta: 0.008333333767950535 },
  ]);
  expect(result.velocity).toEqual([2, 0.505828857421875, 3]);
  expect(result.appliedVelocity).toEqual(result.velocity);
  expect(s.verticalFacingType).toBe("VeritcalFacingMatchVelocity");
  expect(
    stepPresentationMissileFrame(frame, state(), 1, 1 / 120, 0).velocity[1],
  ).toBe(0);
});
test("invalid global clocks cannot mutate the owned movement frame", () => {
  let calls = 0;
  const frame = {
    step() {
      calls++;
      throw Error("unexpected step");
    },
  };
  for (const globalDelta of [NaN, Infinity, 1e100, -1])
    expect(() =>
      stepPresentationMissileFrame(frame, state(), 1, 1 / 60, globalDelta),
    ).toThrow("global MatchVelocity");
  expect(calls).toBe(0);
});
