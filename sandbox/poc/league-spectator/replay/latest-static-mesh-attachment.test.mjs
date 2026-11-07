import { expect, test } from "bun:test";
import { loadLatestDirectEffectPackage } from "./latest-direct-effect-package.mjs";
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

const directory = ".cache/replay-spike/public",
  load = (path) => Bun.file(`${directory}/${path}`).bytes();
const id = "champions/hecarim/0/e57b8289";
const loaded = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: await load("latest-effects/manifest.json"),
  effectIds: [id],
});
const definition = loaded.definitions.get(id),
  meshIndex = definition.emitters.findIndex(
    (emitter) => emitter.primitive === "static-mesh",
  );
if (meshIndex < 0)
  throw Error(
    "Installed Hecarim mesh component required for attachment integration fixture",
  );
const report = (
  await Bun.file(
    ".cache/replay-spike/research/viewer-root-reconstruction.json",
  ).json()
).report;
const scene = await Bun.file(`${directory}/latest-scene/manifest.json`).json();
const assets = await loadLatestViewerPoseAssets({
  profile: loaded.profile,
  report,
  scene,
  load,
});
const heights = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(heights.buffer, heights.byteOffset, heights.byteLength / 4),
);
const packetPlacement = await createLatestDirectEffectPlacement({
  profile: loaded.profile,
  packageBytes: await load("latest-world-descriptor-abi/package.json"),
});

function fixture(changedDefinition = definition) {
  const world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    viewerPoseAssets: assets,
  });
  const policy = createLatestViewerPoseAttachmentPlacement({
    profile: loaded.profile,
    packetPlacement,
    definitions: new Map([[id, changedDefinition]]),
  });
  return {
    world,
    resolve(descriptor, suppliedWorld = world) {
      return policy.resolve({
        event: { definitionId: id, descriptor },
        time: descriptor.time,
        cursor: {
          transportSequence: descriptor.transportSequence,
          entryOrder: descriptor.creationSequence,
        },
        references: suppliedWorld.references(descriptor, descriptor.time),
        world: suppliedWorld,
      });
    },
  };
}

test("actual Hecarim requests keep shared pose basis and four references with the installed mesh sibling", () => {
  const current = fixture();
  for (const entityId of [1073744329, 1073745275]) {
    const descriptor = report.effectDescriptors.find(
      (row) => row.entityId === entityId,
    );
    const value = current.resolve(descriptor);
    expect(value.resolved).toBe(true);
    expect(value.policy).toBe(VIEWER_POSE_ATTACHMENT_POLICY);
    expect(value.references.map((row) => row.field)).toEqual(
      EFFECT_ENTITY_FIELDS,
    );
    expect(value.basis.length).toBe(9);
    expect(value.poseEvidence.nativePoseParity).toBeNull();
    expect(value.poseEvidence.nativeAcceptance).toBeNull();
    expect(value.poseEvidence.source.keys).toEqual([0]);
  }
});

test("supplied matrix-skip root fixture keeps packet basis without broadening provider gates", () => {
  const current = fixture(),
    actual = report.effectDescriptors.find(
      (row) => row.entityId === 1073744329,
    );
  const descriptor = {
    ...structuredClone(actual),
    lookup14EntityId: 0,
    flags: 0x30,
  };
  const value = current.resolve(descriptor);
  expect(value.resolved).toBe(true);
  expect(value.policy).toBe(VIEWER_ROOT_ATTACHMENT_POLICY);
  expect(value.basis).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(
    current.resolve({ ...descriptor, lookupA8EntityId: 123 }).resolved,
  ).toBe(false);
  expect(
    current.resolve({ ...descriptor, attachmentKey4c: 0xffffffff }).resolved,
  ).toBe(false);
});

test("missing/corrupt mesh metadata and other primitives cannot bypass attachment admission", () => {
  const actual = report.effectDescriptors.find(
    (row) => row.entityId === 1073744329,
  );
  const corrupt = structuredClone(definition);
  corrupt.emitters[meshIndex].meshMaterialSelection.policy.shaderPair.vertex =
    "0".repeat(64);
  expect(() => fixture(corrupt).resolve(actual)).toThrow("material identity");
  const missing = structuredClone(definition);
  delete missing.emitters[meshIndex].meshProgram;
  expect(() => fixture(missing).resolve(actual)).toThrow("static mesh program");
  const forgedRay = structuredClone(definition);
  forgedRay.emitters.push({ index: 999, primitive: "ray" });
  expect(() => fixture(forgedRay).resolve(actual)).toThrow(
    "Malformed compiled default Ray particle program",
  );
  const unknown = structuredClone(definition);
  unknown.emitters.push({ index: 999, primitive: "beam" });
  expect(fixture(unknown).resolve(actual).reasons).toContain(
    "world:viewer-pose-component-not-admitted:999:beam",
  );
});
