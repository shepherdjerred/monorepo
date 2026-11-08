import { expect, test } from "bun:test";
import { createFixedTimeMovement } from "./latest-fixed-time-movement.mjs";
import { createLatestMissileMotion } from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import {
  readCastIndexedOverrideCount,
  requireEmptyCastIndexedOverrides,
} from "./latest-cast-indexed-overrides.mjs";
const read = async (name) =>
  Bun.file(
    new URL(
      `../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-${name}.json`,
      import.meta.url,
    ),
  ).json();
const kernel = createFixedTimeMovement(
  createLatestMissileMotion(await read("motion")),
  createLatestMissileControllers(await read("controllers")),
);
const inputs = {
  position: [0, 0, 0],
  targetPosition: [1000, 100, 0],
  travelTime: 1,
  startDelay: 0,
  createdAt: 12,
  travelTimeOverride: null,
  gravity: 3000,
};

test("fixed-time clocks retain float32 deadline and explicit indexed override semantics", () => {
  const state = kernel.initialize(inputs);
  expect(state.deadline).toBe(13);
  expect(state.duration).toBe(1);
  expect(
    kernel.initialize({ ...inputs, travelTimeOverride: 0.5 }).deadline,
  ).toBe(12.5);
  expect(
    kernel.initialize({ ...inputs, createdAt: 1024, travelTime: 0.4 }).deadline,
  ).toBe(Math.fround(Math.fround(1024) + Math.fround(0.4)));
  const at = kernel.step(state, 13, 1 / 60);
  expect(at.position).toEqual(inputs.targetPosition);
  expect(at.arrived).toBe(false);
  expect(kernel.step(state, 13.1, 1 / 60).arrived).toBe(true);
});

test("default gravity and moving endpoints survive retained-state restore without sharing arrays", () => {
  const state = kernel.initialize(inputs);
  kernel.step(state, 12.1, 1 / 60);
  const saved = structuredClone(state),
    restored = structuredClone(saved);
  state.targetPosition = [1200, 20, 30];
  restored.targetPosition = [...state.targetPosition];
  expect(kernel.step(state, 12.2, 1 / 60)).toEqual(
    kernel.step(restored, 12.2, 1 / 60),
  );
  expect(saved.targetPosition).toEqual(inputs.targetPosition);
  expect(state.position).not.toEqual(saved.position);
  expect(kernel.actualMatchAdmitted).toBe(false);
});

test("original interior split uses global frame delta for post-height MatchVelocity", () => {
  // Original 16.21 controller, decoded sequence3288, supplied interior clock.
  // Native fixture: zero-reference-fixed-time-supplied-interior-split-native,
  // tick10. The local interval is 1/120 while callback890880 reads 1/60.
  const floats = (hex) => {
    const bytes = Uint8Array.fromHex(hex);
    return [...new Float32Array(bytes.buffer)];
  };
  const state = kernel.initialize({
    position: floats("b86ae7459ea99cc239ebde45"),
    targetPosition: floats("87dbca45769eecc22fdbda45"),
    travelTime: Math.fround(0.4),
    startDelay: 0,
    createdAt: 84.22830200195312,
    travelTimeOverride: null,
    gravity: 5000,
  });
  Object.assign(state, {
    position: floats("f4ffda45d0f0adc00927dd45"),
    velocity: floats("bc0015c547eb7842c791a9c3"),
    speed: floats("db871045")[0],
    deadline: floats("b141a942")[0],
  });
  const result = kernel.step(
    state,
    84.40330505371094,
    0.008333333767950535,
    0.01666666753590107,
  );
  const bytes = new Uint8Array(
    new Float32Array([result.speed, ...result.velocity, ...result.displacement])
      .buffer,
  );
  expect(bytes.toHex()).toBe(
    "baee1045ec7c0fc5007e013f0f4ba3c3c90d99c100200a3cee2d2ec0",
  );
  expect(result.velocity[1]).toBe(0.505828857421875);
  expect(result.displacement[1]).toBe(0.00843048095703125);
  expect(result.arrived).toBe(false);
});

test("unknown override presence, malformed vectors and invalid supplied clocks fail before simulation", () => {
  expect(() =>
    kernel.initialize({ ...inputs, travelTimeOverride: undefined }),
  ).toThrow("override presence");
  for (const bad of [null, true, "3", Infinity, 1e100]) {
    expect(() => kernel.initialize({ ...inputs, travelTime: bad })).toThrow(
      "finite",
    );
    expect(() =>
      kernel.initialize({ ...inputs, position: [0, bad, 0] }),
    ).toThrow("finite");
  }
  const state = kernel.initialize(inputs),
    before = structuredClone(state);
  expect(() => kernel.step(state, 12, -1)).toThrow("clocks");
  expect(state).toEqual(before);
});

test("raw indexed override counts retain the producer boundary and reject nonempty or missing metadata", () => {
  const raw = new Uint8Array(200),
    view = new DataView(raw.buffer);
  expect(readCastIndexedOverrideCount(raw, 24)).toBe(0);
  view.setUint32(24 + 0x60, 0xffffffff, true);
  expect(readCastIndexedOverrideCount(raw, 24)).toBe(0xffffffff);
  expect(
    requireEmptyCastIndexedOverrides({ indexedOverrideCount: 0 }),
  ).toMatchObject({ resolved: true, travelTimeOverride: null });
  expect(
    requireEmptyCastIndexedOverrides({ indexedOverrideCount: 1 }).resolved,
  ).toBe(false);
  expect(() => requireEmptyCastIndexedOverrides({})).toThrow("Explicit");
  expect(() =>
    requireEmptyCastIndexedOverrides({ indexedOverrideCount: "0" }),
  ).toThrow("Explicit");
  expect(() => readCastIndexedOverrideCount(raw, -1)).toThrow("Bounded");
  expect(() => readCastIndexedOverrideCount(raw, 150)).toThrow("Bounded");
});
