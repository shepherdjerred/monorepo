import { expect, test } from "bun:test";
import { compareDirectChildSiblingControls } from "./latest-direct-child-sibling-control.mjs";

function pair() {
  const make = (variant) => ({
    kind: "original-child-free-sibling-independence-control",
    variant,
    completed: true,
    boundary: null,
    requestedFrames: 61,
    siblingIndices: [17],
    effectId: "fixture",
    build: "build",
    protocol: "protocol",
    lookupSuccesses: variant === "authored" ? [{}] : [],
    factories: variant === "authored" ? [{}, {}] : [{}],
    details: { typedChildControls: variant === "authored" ? [] : [{}] },
    scope: {
      childGlobalSchedulerActivationRecovered: false,
      parentSchedulerOrRngReplaced: false,
    },
    frames: Array.from({ length: 61 }, (_, index) => ({
      time: index / 60,
      state: {
        rngHex: "00".repeat(12),
        actors: [
          {
            kind: "complex",
            emitterIndex: 17,
            vectors: { life: { count: 1, bytesHex: "00".repeat(8) } },
          },
        ],
      },
      siblingDraws: [
        {
          emitterIndex: 17,
          kind: "camera-quad",
          particleCount: 1,
          verticesHex: "00".repeat(112),
          indicesHex: "00".repeat(12),
        },
      ],
    })),
  });
  return [make("authored"), make("typed-child-null")];
}
test("compares ordered sibling pool, geometry and RNG bytes without pointer equivalence", () => {
  const [a, b] = pair();
  const result = compareDirectChildSiblingControls(a, b);
  expect(result.matched).toBe(true);
  expect(result.counts.siblingFrames).toBe(61);
  b.frames[30].state.actors[0].vectors.life.bytesHex = "01".repeat(8);
  b.frames[31].siblingDraws[0].verticesHex = "01".repeat(112);
  b.frames[32].state.rngHex = "01".repeat(12);
  expect(compareDirectChildSiblingControls(a, b).differences).toEqual([
    "30:17:life:bytes",
    "31:17:vertices",
    "32:globalRng",
  ]);
});
test("requires exercised successful child branch and complete nonvacuous controls", () => {
  const [a, b] = pair();
  a.lookupSuccesses = [];
  expect(() => compareDirectChildSiblingControls(a, b)).toThrow();
  a.lookupSuccesses = [{}];
  b.frames.pop();
  expect(() => compareDirectChildSiblingControls(a, b)).toThrow();
  const [c, d] = pair();
  for (const control of [c, d])
    for (const frame of control.frames) {
      frame.siblingDraws[0].particleCount = 0;
      frame.siblingDraws[0].verticesHex = frame.siblingDraws[0].indicesHex = "";
    }
  expect(() => compareDirectChildSiblingControls(c, d)).toThrow();
});
