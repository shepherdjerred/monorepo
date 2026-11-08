import { expect, test } from "bun:test";
import {
  initializeNamedBoneCasterStart,
  initializeNamedBoneTypeOneCasterStart,
  NAMED_BONE_TYPE_ONE_CASTER_START_POLICY,
} from "./latest-named-bone-caster-start.mjs";
import { VIEWER_ROOT_POLICY } from "./latest-world-presentation.mjs";
import { VIEWER_POSE_POLICY } from "./latest-viewer-pose-sampler.mjs";
function fixture() {
  let queries = 0;
  const record = {
    time: 4,
    transportSequence: 7,
    entryOrder: 0,
    cast: {
      ownerId: 3,
      forceRecordedSourcePosition: false,
      overrideFlag14d: 0,
      sourcePosition: [9, 21, 29],
    },
  };
  const settings = { castType: 3, particleStartOffset: [0, 0, 0] },
    root = {
      resolved: true,
      policy: VIEWER_ROOT_POLICY,
      entityId: 3,
      time: 4,
      position: [10, 20, 30],
      lifecycle: "alive",
    };
  const rig = {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    actorKey: "actor/0",
    rigSha256: "1".repeat(64),
    binding: {
      name: "Weapon",
      resolvedBoneKey: 11,
      nativePoseIndex: 2,
      keyPoseIndex: 2,
    },
  };
  const pose = {
    resolved: true,
    policy: VIEWER_POSE_POLICY,
    entityId: 3,
    time: 4,
    attachments: [
      { name: "Weapon", key: 11, nativePoseIndex: 2, position: [12, 70, 34] },
    ],
    poseEvidence: {
      actorKey: "actor/0",
      staticHashes: { rig: rig.rigSha256 },
      cursor: { transportSequence: 7, entryOrder: 0 },
      omissions: ["pose:supplied-control"],
    },
  };
  return {
    record,
    settings,
    sourceBoneName: "Weapon",
    root,
    rig,
    pose,
    terrain: {
      sampleHeight(x, z) {
        queries++;
        return { inside: true, height: Math.fround(x * 0.25 + z * 0.5) };
      },
    },
    queries: () => queries,
  };
}
test("type3 rebases recorded source with independent plane and attachment height offsets", () => {
  const f = fixture(),
    result = initializeNamedBoneCasterStart(f);
  expect(result.position).toEqual([9, 71, 29]);
  expect(result.planeHeightOffset).toBe(50);
  expect(result.attachmentHeightOffset).toBe(-47.5);
  f.root.position[0] += 4;
  const moved = initializeNamedBoneCasterStart(f);
  expect(moved.position).toEqual(result.position);
  expect(moved.planeHeightOffset).toBe(result.planeHeightOffset);
  expect(moved.attachmentHeightOffset).toBe(-48.5);
  f.pose.attachments[0].position[1] += 37;
  const raised = initializeNamedBoneCasterStart(f);
  expect(raised.position).toEqual([9, 108, 29]);
  expect(raised.planeHeightOffset).toBe(87);
  expect(raised.attachmentHeightOffset).toBe(-11.5);
});
test("missing pose stays unresolved without querying terrain or substituting the root", () => {
  const f = fixture();
  f.pose = {
    resolved: false,
    reasons: ["pose:viewer-actor-orientation-unresolved"],
  };
  const result = initializeNamedBoneCasterStart(f);
  expect(result.resolved).toBe(false);
  expect(result.position).toBeNull();
  expect(result.reasons).toContain("pose:viewer-actor-orientation-unresolved");
  expect(f.queries()).toBe(0);
});
test("foreign poses, missing names, offsets and unproved cast branches remain blocked", () => {
  for (const mutate of [
    (f) => (f.pose.poseEvidence.cursor.entryOrder = 1),
    (f) => (f.pose.attachments = []),
    (f) => (f.settings.particleStartOffset = [0, 0, 1]),
    (f) => (f.record.cast.overrideFlag14d = 1),
    (f) => (f.record.cast.forceRecordedSourcePosition = true),
    (f) => (f.settings.castType = 1),
  ]) {
    const f = fixture();
    mutate(f);
    const result = initializeNamedBoneCasterStart(f);
    expect(result.resolved).toBe(false);
    expect(result.position).toBeNull();
    expect(f.queries()).toBe(0);
  }
});

test("type1 preserves the case-insensitively resolved named bone XYZ without a ground rebase", () => {
  const f = fixture();
  f.settings.castType = 1;
  f.sourceBoneName = "WEAPON";
  const result = initializeNamedBoneTypeOneCasterStart(f);
  expect(result.policy).toBe(NAMED_BONE_TYPE_ONE_CASTER_START_POLICY);
  expect(result.position).toEqual([12, 70, 34]);
  expect(result.groundRebase).toBe(false);
  expect(result.planeHeightOffset).toBe(0);
  expect(result.attachmentHeightOffset).toBe(-47.5);
  expect(result.boneGroundHeightStatus).toBe("not-queried");
  expect(f.queries()).toBe(1);
  f.root.position[0] += 4;
  f.record.cast.sourcePosition = [999, -300, 888];
  const moved = initializeNamedBoneTypeOneCasterStart(f);
  expect(moved.position).toEqual(result.position);
  expect(moved.attachmentHeightOffset).toBe(-48.5);
  expect(moved.nativeAcceptance).toBeNull();
});

test("type1 cannot use a foreign pose, unknown namespace, forced source or type3 branch", () => {
  for (const mutate of [
    (f) => f.pose.poseEvidence.cursor.transportSequence++,
    (f) => f.pose.attachments[0].nativePoseIndex++,
    (f) => (f.pose.attachments[0].name = "Different"),
    (f) => f.rig.binding.keyPoseIndex++,
    (f) => (f.record.cast.forceRecordedSourcePosition = true),
    (f) => (f.settings.castType = 3),
  ]) {
    const f = fixture();
    f.settings.castType = 1;
    mutate(f);
    const result = initializeNamedBoneTypeOneCasterStart(f);
    expect(result.resolved).toBe(false);
    expect(result.position).toBeNull();
    expect(f.queries()).toBe(0);
  }
  const f = fixture();
  f.settings.castType = 1;
  f.pose = {
    resolved: false,
    reasons: ["pose:viewer-actor-orientation-unresolved"],
  };
  expect(initializeNamedBoneTypeOneCasterStart(f).reasons).toContain(
    "pose:viewer-actor-orientation-unresolved",
  );
  expect(f.queries()).toBe(0);
});
