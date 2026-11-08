import { expect, test } from "bun:test";
import { loadLatestViewerPoseAssets } from "./latest-viewer-pose-assets.mjs";
import {
  createLatestWorldPresentation,
  EFFECT_ENTITY_FIELDS,
} from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createLatestDirectEffectPlacement } from "./latest-direct-effect-placement.mjs";
import {
  createLatestViewerPoseAttachmentPlacement,
  VIEWER_POSE_ATTACHMENT_POLICY,
} from "./latest-viewer-pose-attachment.mjs";
import { VIEWER_ROOT_ATTACHMENT_POLICY } from "./latest-viewer-root-attachment.mjs";
const cache = ".cache/replay-spike/public",
  load = (path) => Bun.file(`${cache}/${path}`).bytes(),
  profile = await Bun.file(`${cache}/decoder-16.21-macos/profile.json`).json(),
  scene = await Bun.file(`${cache}/latest-scene/manifest.json`).json(),
  report = (
    await Bun.file(
      ".cache/replay-spike/research/viewer-root-reconstruction.json",
    ).json()
  ).report;
const assets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
  }),
  heights = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  ),
  packetPlacement = await createLatestDirectEffectPlacement({
    profile,
    packageBytes: await load("latest-world-descriptor-abi/package.json"),
  });
const definitionId = "supplied-policy-unit-control",
  definitions = new Map([
    [
      definitionId,
      { blockers: [], emitters: [{ index: 0, primitive: "camera-quad" }] },
    ],
  ]),
  policy = createLatestViewerPoseAttachmentPlacement({
    profile,
    packetPlacement,
    definitions,
  }),
  descriptor = report.effectDescriptors.find((d) => d.entityId === 1073743539);
function resolve(changes = {}, overrideWorld = null) {
  const d = { ...structuredClone(descriptor), ...changes },
    world =
      overrideWorld ??
      createLatestWorldPresentation({
        report,
        scene,
        terrain,
        viewerPoseAssets: assets,
      });
  return policy.resolve({
    event: { definitionId, descriptor: d },
    time: d.time,
    cursor: {
      transportSequence: d.transportSequence,
      entryOrder: d.creationSequence,
    },
    references: world.references(d, d.time),
    world,
  });
}
test("explicit same-viewer attachment policy keeps all four references, static digest and separate source/target poses", () => {
  const result = resolve();
  expect(result.resolved).toBe(true);
  expect(result.policy).toBe(VIEWER_POSE_ATTACHMENT_POLICY);
  expect(result.references.map((ref) => ref.field)).toEqual(
    EFFECT_ENTITY_FIELDS,
  );
  expect(result.poseEvidence.source.keys).toEqual([180417155]);
  expect(result.poseEvidence.target.keys).toEqual([0]);
  expect(result.poseEvidence.presentationContentHash).toBe(assets.contentHash);
  expect(result.poseEvidence.nativeAcceptance).toBeNull();
  expect(result.poseEvidence.nativePoseParity).toBeNull();
  expect(result.position).not.toEqual(result.secondaryPosition);
  expect(result.boundObjectSize).toBeUndefined();
});
test("missing/nonordinary providers cannot fall back to packet/root/basis defaults", () => {
  expect(resolve({ attachmentKey4c: 204644787 }).reasons).toContain(
    "world:source:pose:installed-key-unresolved:204644787",
  );
  expect(resolve({ lookupA8EntityId: 123 }).resolved).toBe(false);
  expect(resolve({ flags: descriptor.flags | 0x40 }).reasons).toContain(
    "world:untranslated-placement-flags:64",
  );
  expect(
    resolve({ byteFields: { ...descriptor.byteFields, field98: 1 } }).reasons,
  ).toContain("world:special-source-transform-provider");
  expect(resolve({ vector6c: [0, 1, 0] }).resolved).toBe(false);
});
test("the existing source-root matrix-skip branch stays independent of a pose policy", () => {
  const result = resolve({
    lookup14EntityId: 0,
    attachmentKey4c: 0,
    flags: 0x30,
  });
  expect(result.resolved).toBe(true);
  expect(result.policy).toBe(VIEWER_ROOT_ATTACHMENT_POLICY);
  expect(result.poseEvidence).toBeUndefined();
});
test("provider ownership/evidence mismatch throws instead of accepting a detached or forged pose", () => {
  const world = createLatestWorldPresentation({
      report,
      scene,
      terrain,
      viewerPoseAssets: assets,
    }),
    original = world.viewerPose;
  const spoof = {
    ...world,
    viewerPose: (...args) => {
      const result = original(...args);
      if (result.resolved) result.entityId++;
      return result;
    },
  };
  expect(() => resolve({}, spoof)).toThrow(
    "Same-viewer pose source identity/evidence differs",
  );
});

test("composed evidence shares exact immutable pose observations but public queries remain independent", () => {
  const world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    viewerPoseAssets: assets,
  });
  // world.viewerPose is the public independent-copy boundary. Supply the
  // immutable observations used internally by actual placement consumers.
  const cached = new Map();
  const snapshotWorld = {
    ...world,
    viewerPose: (...args) => {
      const key = JSON.stringify(args);
      if (!cached.has(key)) {
        const value = world.viewerPose(...args);
        const freeze = (row) => {
          if (row && typeof row === "object") {
            for (const v of Object.values(row)) freeze(v);
            Object.freeze(row);
          }
          return row;
        };
        cached.set(key, freeze(value));
      }
      return cached.get(key);
    },
  };
  const first = resolve({}, snapshotWorld),
    second = resolve({}, snapshotWorld);
  expect(first.poseEvidence).toBe(second.poseEvidence);
  expect(Object.isFrozen(first.poseEvidence)).toBe(true);
  const laterCursor = resolve(
      { transportSequence: descriptor.transportSequence + 1 },
      snapshotWorld,
    ),
    laterTime = resolve({ time: descriptor.time + 1e-8 }, snapshotWorld);
  expect(laterCursor.poseEvidence).not.toBe(first.poseEvidence);
  expect(laterCursor.poseEvidence.source.cursor.transportSequence).toBe(
    descriptor.transportSequence + 1,
  );
  expect(Math.fround(laterTime.poseEvidence.source.time)).toBe(
    Math.fround(first.poseEvidence.source.time),
  );
  expect(laterTime.poseEvidence).not.toBe(first.poseEvidence);
  expect(laterTime.poseEvidence.source.time).toBe(descriptor.time + 1e-8);
  expect(resolve({}, world).poseEvidence).not.toBe(
    resolve({}, world).poseEvidence,
  );
  const a = world.viewerPose(
      descriptor.attachmentEntityId,
      [descriptor.attachmentKey4c],
      descriptor.time,
    ),
    b = world.viewerPose(
      descriptor.attachmentEntityId,
      [descriptor.attachmentKey4c],
      descriptor.time,
    );
  expect(a.poseEvidence).not.toBe(b.poseEvidence);
  a.poseEvidence.keys[0]++;
  expect(b.poseEvidence.keys).toEqual([descriptor.attachmentKey4c]);
});
