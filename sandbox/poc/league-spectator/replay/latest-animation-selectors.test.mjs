import { expect, test } from "bun:test";
import { createAnimationGraph } from "./latest-animation.mjs";
import {
  bindLatestDeathAnimationChoices,
  selectLatestAnimationWeightedPair,
} from "./latest-animation-selectors.mjs";
import { sampleLatestDeathPosePreview } from "./latest-lifecycle.mjs";

const pairs = [
  { mClipName: "Death_Base", mProbability: 50 },
  { mClipName: "Death_Second", mProbability: 50 },
];
function graph() {
  const source = {
      root: {
        __type: "AnimationGraphData",
        mTrackDataMap: { Default: {} },
        mClipDataMap: {
          Death: {
            __type: "SelectorClipData",
            mSelectorPairDataList: structuredClone(pairs),
          },
          Death_Base: { __type: "AtomicClipData" },
          Death_Second: { __type: "AtomicClipData" },
        },
      },
    },
    catalog = {
      schema: 1,
      joints: [],
      clips: {
        Death_Base: { file: "base.clip", fps: 30 },
        Death_Second: { file: "second.clip", fps: 30 },
      },
    };
  return createAnimationGraph(source, catalog, {
    evaluate: (name, time) => ({
      duration: name === "Death_Base" ? 4.6 : 4,
      poseTime: time,
      frame: time * 30,
    }),
  });
}
test("original float32 weighted selection preserves inclusive native boundaries and rejects unbound weight inputs", () => {
  expect(selectLatestAnimationWeightedPair(pairs, 0)).toBe("Death_Base");
  expect(selectLatestAnimationWeightedPair(pairs, 0.5)).toBe("Death_Base");
  expect(
    selectLatestAnimationWeightedPair(pairs, Math.fround(0.50000006)),
  ).toBe("Death_Second");
  expect(selectLatestAnimationWeightedPair(pairs, 1)).toBe("Death_Second");
  expect(() =>
    selectLatestAnimationWeightedPair([{ mClipName: "invented" }], 0.1),
  ).toThrow("Explicit");
  expect(() =>
    selectLatestAnimationWeightedPair(
      [{ mClipName: "zero", mProbability: 0 }],
      0.1,
    ),
  ).toThrow("Positive");
  expect(() => selectLatestAnimationWeightedPair(pairs, NaN)).toThrow(
    "unit random",
  );
});
test("recorded death order owns a persistent per-activation variant across backward sampling without consuming fresh random values", () => {
  const sharedGraph = graph(),
    deathA = { entityId: 10, sequence: 3, transportSequence: 100, time: 1 },
    deathB = { entityId: 20, sequence: 4, transportSequence: 200, time: 2 },
    intervalA = { death: deathA, respawn: null, postDeathActions: [] },
    intervalB = { death: deathB, respawn: null, postDeathActions: [] },
    lifecycle = {
      tracks: new Map([
        [10, [intervalA]],
        [20, [intervalB]],
      ]),
    },
    values = [0.25, 0.75];
  let draws = 0;
  const owner = bindLatestDeathAnimationChoices(
    [
      { event: { entityId: 20 }, graph: sharedGraph },
      { event: { entityId: 10 }, graph: sharedGraph },
    ],
    lifecycle,
    {
      next: () => values[draws++],
      snapshot: () => ({ draws, stateHex: "0000000000000001" }),
    },
  );
  const lifeA = { dead: true, interval: intervalA },
    lifeB = { dead: true, interval: intervalB };
  expect(draws).toBe(2);
  expect(
    sharedGraph.evaluate("Death", 0, { moving: false }).unresolved,
  ).toHaveLength(1);
  const before = owner.diagnostics();
  for (const [life, time, file] of [
    [lifeB, 2.2, "second.clip"],
    [lifeA, 1.2, "base.clip"],
    [lifeB, 10, "second.clip"],
    [lifeA, 1.2, "base.clip"],
  ]) {
    const choice = owner.forDeath(sharedGraph, life),
      pose = sampleLatestDeathPosePreview(sharedGraph, life, time, choice);
    expect(pose.unresolved).toEqual([]);
    expect(pose.leaves[0].file).toBe(file);
    expect(pose.leaves[0].phase).toBeLessThan(pose.duration);
  }
  expect(owner.diagnostics()).toEqual(before);
  expect(draws).toBe(2);
  expect(() =>
    sharedGraph.evaluate("Death", 0, { selectorChoice: {} }),
  ).toThrow("Owned activation");
  expect(() =>
    graph().evaluate("Death", 0, {
      selectorChoice: owner.forDeath(sharedGraph, lifeA),
    }),
  ).toThrow("this original selector node");
  expect(() => owner.forDeath(sharedGraph, structuredClone(lifeA))).toThrow(
    "Recorded death",
  );
  const staleChoice = owner.forDeath(sharedGraph, lifeA);
  owner.close();
  expect(owner.diagnostics().graphs).toBe(0);
  expect(() => owner.forDeath(sharedGraph, lifeA)).toThrow("Closed");
  expect(() =>
    sharedGraph.evaluate("Death", 0, { selectorChoice: staleChoice }),
  ).toThrow("Owned activation");
});
