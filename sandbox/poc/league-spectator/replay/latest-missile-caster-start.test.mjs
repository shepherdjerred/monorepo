import { expect, test } from "bun:test";
import { initializeEmptyBoneCasterStart } from "./latest-missile-caster-start.mjs";
import { VIEWER_ROOT_POLICY } from "./latest-world-presentation.mjs";
const input = () => ({
  record: {
    time: 12,
    cast: {
      ownerId: 7,
      forceRecordedSourcePosition: false,
      overrideFlag14d: 0,
    },
  },
  settings: { castType: 1, particleStartOffset: [0, 0, 0] },
  sourceBoneName: "",
  rig: {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    rigSha256: "a".repeat(64),
    resolvedBoneKeys: [1, 2],
  },
  root: {
    resolved: true,
    policy: VIEWER_ROOT_POLICY,
    entityId: 7,
    time: 12,
    position: [33, -900, 67],
    positionStatus: "movement-derived-preview",
    lifecycle: "alive",
    omissions: [],
  },
  terrain: {
    sampleHeight: () => ({ inside: true, height: Math.fround(-178.33) }),
  },
});
test("empty-bone terrain start uses supplied matching root XZ and terrain plus original 100", () => {
  const value = input(),
    result = initializeEmptyBoneCasterStart(value);
  expect(result.position).toEqual([
    33,
    Math.fround(Math.fround(-178.33) + 100),
    67,
  ]);
  value.root.position[0] = 500;
  expect(result.sourceRoot.position[0]).toBe(33);
  expect(result.nativeAcceptance).toBeNull();
});
test("unsupported starts remain unresolved without guessed placement", () => {
  for (const alter of [
    (x) => (x.record.cast.forceRecordedSourcePosition = true),
    (x) => (x.record.cast.overrideFlag14d = 1),
    (x) => (x.settings.castType = 3),
    (x) => (x.settings.particleStartOffset[1] = 1),
    (x) => (x.sourceBoneName = "root"),
    (x) => x.rig.resolvedBoneKeys.push(0),
    (x) => (x.root.entityId = 8),
    (x) => (x.root.time = 13),
    (x) => (x.root.lifecycle = "dead"),
    (x) => (x.root.resolved = false),
    (x) => (x.root.position = null),
  ]) {
    const value = input();
    alter(value);
    const result = initializeEmptyBoneCasterStart(value);
    expect(result.resolved).toBe(false);
    expect(result.position).toBeNull();
  }
});
test("explicit original out-of-navgrid zero applies only after actual root resolution", () => {
  const value = input();
  value.terrain.sampleHeight = () => ({ inside: false, height: null });
  expect(initializeEmptyBoneCasterStart(value).position).toEqual([33, 100, 67]);
});
