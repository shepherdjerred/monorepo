import { expect, test } from "bun:test";
import {
  loadLatestViewerPoseAssets,
  restoreLatestViewerPoseAssets,
} from "./latest-viewer-pose-assets.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { compareLatestViewerPoseRecords } from "./latest-viewer-pose-service.mjs";
import { loadLatestInitialResourcePrefix } from "./latest-initial-resource-prefix.mjs";
const cache = ".cache/replay-spike/public",
  read = (path) => Bun.file(`${cache}/${path}`).bytes();
const profile = await Bun.file(
    `${cache}/decoder-16.21-macos/profile.json`,
  ).json(),
  scene = await Bun.file(`${cache}/latest-scene/manifest.json`).json(),
  report = (
    await Bun.file(
      ".cache/replay-spike/research/viewer-root-reconstruction.json",
    ).json()
  ).report,
  heights = await read("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  );
const assets = await loadLatestViewerPoseAssets({
  profile,
  report,
  scene,
  load: read,
});
const entityId = report.heroes.find(
    (hero) => hero.champion === "Ornn",
  ).entityId,
  time = 72.23738861083984,
  key = 180417155;
const worldFor = (input = report) =>
  createLatestWorldPresentation({
    report: input,
    scene,
    terrain,
    viewerPoseAssets: assets,
  });
test("actual installed negative-form gear observations preserve the declared rig while a positive form still invalidates it", async () => {
  const hero = report.heroes.find((h) => h.champion === "Akshan"),
    time = 69,
    manifestBytes = await read("latest-effects/manifest.json"),
    { policy } = await loadLatestInitialResourcePrefix({
      profile,
      load: read,
      manifestBytes,
      report,
    }),
    world = createLatestWorldPresentation({
      report,
      scene,
      terrain,
      viewerPoseAssets: assets,
      initialResourcePrefix: policy,
    }),
    key = assets.actor(hero.entityId).bindings[0].resolvedBoneKey,
    actual = world.viewerPose(hero.entityId, [0, key], time);
  expect(actual.resolved).toBe(true);
  expect(
    actual.poseEvidence.prefixPreservingRequestObservations.map(
      (o) => o.request.stream,
    ),
  ).toEqual([2, 2]);
  expect(
    actual.poseEvidence.prefixPreservingRequestObservations.every(
      (o) => o.rigIdentityPreserved,
    ),
  ).toBe(true);
  expect(actual.poseEvidence.omissions).toContain(
    "form:snapshot-restoration-unimplemented-native-acceptance-unknown",
  );
  expect(actual.nativePoseParity).toBeNull();
  expect(world.viewerPose(hero.entityId, [0, key], time)).toEqual(actual);
  const raw = report.resourceRequests.find((r) => r.entityId === hero.entityId),
    positive = {
      ...raw,
      id: "resource-request:999999:0",
      transportSequence: 999999,
      time,
      index: 0,
      signedIndex: 0,
      stream: 1,
      chunkId: 0,
    },
    changed = {
      ...report,
      resourceRequests: [...report.resourceRequests, positive],
    },
    changedPolicy = (
      await loadLatestInitialResourcePrefix({
        profile,
        load: read,
        manifestBytes,
        report: changed,
      })
    ).policy,
    changedWorld = createLatestWorldPresentation({
      report: changed,
      scene,
      terrain,
      viewerPoseAssets: assets,
      initialResourcePrefix: changedPolicy,
    }),
    before = { transportSequence: 999999, entryOrder: 0, exclusive: true },
    after = { transportSequence: 999999, entryOrder: 0 };
  expect(
    changedWorld.viewerPose(hero.entityId, [0, key], time, before).resolved,
  ).toBe(true);
  expect(
    changedWorld.viewerPose(hero.entityId, [0, key], time, after).resolved,
  ).toBe(false);
  expect(
    changedWorld.viewerPose(hero.entityId, [0, key], time, after)
      .blockingRequest.id,
  ).toBe(positive.id);
  expect(
    changedWorld.viewerPose(hero.entityId, [0, key], time, before).resolved,
  ).toBe(true);
});
test("pinned static pose closure restores in a real worker-compatible core module and rejects model/transfer drift", async () => {
  const restored = await restoreLatestViewerPoseAssets({
    bundle: assets.serialize(),
    profile,
    report,
    scene,
  });
  expect(restored.contentHash).toBe(assets.contentHash);
  const bad = assets.serialize();
  bad.packages["latest-scene/champions/ornn/0/model.glb"][20] ^= 1;
  await expect(
    restoreLatestViewerPoseAssets({ bundle: bad, profile, report, scene }),
  ).rejects.toThrow("Transferred viewer pose asset differs");
  await expect(
    loadLatestViewerPoseAssets({
      profile,
      report,
      scene,
      load: async (path) => {
        const bytes = await read(path);
        if (path === "latest-scene/champions/ornn/0/model.glb") bytes[20] ^= 1;
        return bytes;
      },
    }),
  ).rejects.toThrow("Pinned installed viewer GLB differs");
});
test("causal pose queries retain exact installed key/source/hash evidence and reuse an actor update", () => {
  const world = worldFor(),
    result = world.viewerPose(entityId, [key], time);
  expect(result.resolved).toBe(true);
  expect(result.attachments[0].nativePoseIndex).toBe(59);
  expect(result.poseEvidence.presentationContentHash).toBe(
    world.presentationContentHash,
  );
  expect(result.poseEvidence.staticHashes.model).toMatch(/^[a-f0-9]{64}$/);
  expect(result.nativeAcceptance).toBeNull();
  expect(result.nativePoseParity).toBeNull();
  const root = world.viewerPose(entityId, [0], time);
  expect(root.resolved).toBe(true);
  expect(world.viewerPoseMetrics()).toEqual({ poseUpdates: 1, cacheHits: 1 });
  const queried = new Set(
    report.effectDescriptors.flatMap((d) => [
      ...(d.attachmentEntityId === entityId ? [d.attachmentKey4c] : []),
      ...(d.lookup14EntityId === entityId ? [d.attachmentKey50] : []),
    ]),
  );
  const other = assets
    .actor(entityId)
    .bindings.find(
      (binding) => !queried.has(binding.resolvedBoneKey),
    ).resolvedBoneKey;
  expect(world.viewerPose(entityId, [other], time).attachments[0].key).toBe(
    other,
  );
  result.attachments[0].position[0] = 999;
  expect(
    world.viewerPose(entityId, [key], time).attachments[0].position[0],
  ).not.toBe(999);
});
test("same-time untranslated appearance requests invalidate poses and a backward cursor restores them", () => {
  const modified = structuredClone(report),
    transportSequence = 1000000,
    request = {
      ...structuredClone(report.resourceRequests[0]),
      entityId,
      time,
      transportSequence,
      id: `resource-request:${transportSequence}:0`,
      entryOrder: 0,
    };
  modified.resourceRequests.push(request);
  const world = worldFor(modified),
    before = { transportSequence, entryOrder: 0, exclusive: true },
    after = { transportSequence, entryOrder: 0 };
  const original = world.viewerPose(entityId, [key], time, before);
  expect(original.resolved).toBe(true);
  expect(world.viewerPose(entityId, [key], time, after).reasons).toEqual([
    "pose:untranslated-appearance-or-form-request",
  ]);
  expect(world.viewerPose(entityId, [key], time, before)).toEqual(original);
});
test("the first causal appearance blocker remains stable across interleaved owners, streams and backward queries", () => {
  const modified = structuredClone(report),
    template = report.resourceRequests[0],
    request = (sequence, at, stream) => ({
      ...structuredClone(template),
      entityId,
      time: at,
      stream,
      transportSequence: sequence,
      id: `resource-request:${sequence}:0`,
      entryOrder: 0,
    }),
    first = request(1000001, time, 2),
    later = request(1000002, time + 0.25, 1);
  // Caller order differs from causal order; a request before generation cannot
  // invalidate this actor. The policy deliberately treats either stream's
  // later unimplemented request as unknown rather than synthesizing a restore.
  modified.resourceRequests.push(later, request(0, 0, 1), first);
  const world = worldFor(modified),
    before = {
      transportSequence: first.transportSequence,
      entryOrder: 0,
      exclusive: true,
    },
    original = world.viewerPose(entityId, [key], time, before);
  expect(original.resolved).toBe(true);
  expect(world.viewerPose(entityId, [key], time).blockingRequest.id).toBe(
    first.id,
  );
  expect(world.viewerPose(entityId, [key], time + 0.5).blockingRequest.id).toBe(
    first.id,
  );
  expect(world.viewerPose(entityId, [key], time, before)).toEqual(original);
});
test("private placement poses share immutable source/target views while public queries keep independent ownership", () => {
  const observed = [],
    descriptor = {
      attachmentEntityId: entityId,
      lookup14EntityId: entityId,
      resourceContextEntityId: entityId,
      lookupA8EntityId: 0,
    },
    world = createLatestWorldPresentation({
      report,
      scene,
      terrain,
      viewerPoseAssets: assets,
      placementResolver({ world: view, time: at, cursor }) {
        const source = view.viewerPose(entityId, [key], at, cursor),
          target = view.viewerPose(entityId, [key], at, cursor);
        expect(source).toBe(target);
        expect(Object.isFrozen(source.attachments[0].position)).toBe(true);
        expect(Object.isFrozen(source.poseEvidence.staticHashes)).toBe(true);
        observed.push(source);
        return {
          resolved: source.resolved,
          position: source.attachments[0].position,
        };
      },
    }),
    event = { descriptor },
    cursor = { transportSequence: 1000000, entryOrder: 0 };
  world.placement(event, time, cursor);
  const first = observed[0],
    original = structuredClone(first);
  expect(() => {
    first.attachments[0].position[0] = 999;
  }).toThrow();
  const outward = world.viewerPose(entityId, [key], time, cursor);
  outward.attachments[0].position[0] = 999;
  outward.poseEvidence.staticHashes.model = "changed";
  world.placement(event, time, cursor);
  expect(observed[1]).toBe(first);
  world.placement(event, time, { ...cursor, exclusive: true });
  expect(observed[2]).not.toBe(first);
  expect(observed[2].poseEvidence.cursor.exclusive).toBe(true);
  world.placement(event, time + 0.5, null);
  expect(first).toEqual(original);
  world.placement(event, time, cursor);
  expect(observed.at(-1)).toEqual(original);
  expect(world.viewerPose(entityId, [key], time, cursor)).toEqual(original);
});
test("unknown root orientation, missing identity and missing installed key never become unit-basis attachment poses", () => {
  const world = worldFor();
  expect(world.viewerPose(entityId, [key], 0).reasons).toEqual([
    "pose:viewer-actor-orientation-unresolved",
  ]);
  expect(world.viewerPose(123, [key], time).reasons).toEqual([
    "pose:registered-champion-required",
  ]);
  expect(world.viewerPose(entityId, [204644787], time).reasons).toEqual([
    "pose:installed-key-unresolved:204644787",
  ]);
  expect(() => world.viewerPose(entityId, [, key], time)).toThrow(
    "Dense installed pose keys",
  );
});
test("causal effect queries own separate hierarchies from the actual rendered actor sampler", () => {
  const world = worldFor(),
    entry = assets.createEntry(entityId);
  world.bindViewerPoseActor(entityId, entry);
  const visible = world.presentViewerPose(entityId, time);
  expect(visible.resolved).toBe(true);
  const previous = entry.nodes.map((node) => [...node.matrixWorld.elements]),
    point = entry.group.position.toArray();
  world.viewerPose(entityId, [key], time - 0.5);
  world.viewerPose(entityId, [key], time + 0.5);
  expect(entry.nodes.map((node) => [...node.matrixWorld.elements])).toEqual(
    previous,
  );
  expect(entry.group.position.toArray()).toEqual(point);
  const unknown = world.presentViewerPose(entityId, 0);
  expect(unknown.localPoseOnly).toBe(true);
  expect(unknown.worldAttachmentResolved).toBe(false);
  expect(world.viewerPose(entityId, [key], 0).resolved).toBe(false);
});

test("actual stopped Ornn and Akshan display poses are identical across forward and repeated backward seeks without resolving FX orientation", () => {
  const world = worldFor();
  for (const champion of ["Ornn", "Akshan"]) {
    const hero = report.heroes.find((h) => h.champion === champion),
      entry = assets.createEntry(hero.entityId);
    const bindRotation = entry.group.quaternion.toArray(),
      fxBefore = world.viewerPose(hero.entityId, [0], 82.35);
    world.bindViewerPoseActor(hero.entityId, entry);
    const at = () => {
      const value = world.presentViewerPose(hero.entityId, 82.35);
      return {
        value,
        root: entry.group.quaternion.toArray(),
        matrices: entry.nodes.map((node) => [...node.matrixWorld.elements]),
      };
    };
    const first = at();
    expect(first.value.worldAttachmentResolved).toBe(false);
    expect(first.value.displayFacing.status).toBe("causal-movement-preview");
    expect(
      world.entity(hero.entityId, 82.35).viewerMotion.orientationKnown,
    ).toBe(false);
    expect(fxBefore.resolved).toBe(false);
    expect(world.viewerPose(hero.entityId, [0], 82.35)).toEqual(fxBefore);
    world.presentViewerPose(hero.entityId, 99);
    expect(at()).toEqual(first);
    world.presentViewerPose(hero.entityId, 74);
    expect(at()).toEqual(first);
    const initial = world.presentViewerPose(hero.entityId, 0);
    expect(initial.displayFacing.status).toBe("authored-bind-preview");
    expect(entry.group.quaternion.toArray()).toEqual(bindRotation);
    expect(at()).toEqual(first);
  }
});
test("recorded provider death invalidates continuous pose queries before later world updates can leak in", () => {
  const modified = structuredClone(report),
    death = structuredClone(
      report.lifecycle.find((event) => event.kind === "death-candidate"),
    );
  Object.assign(death, {
    entityId,
    time,
    sequence: 1000000,
    transportSequence: 1000000,
    entryOrder: 0,
  });
  modified.lifecycle.push(death);
  modified.lifecycle.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  const world = worldFor(modified);
  expect(
    world.viewerPose(entityId, [key], time, {
      transportSequence: 999999,
      entryOrder: 0,
    }).resolved,
  ).toBe(true);
  expect(
    world.viewerPose(entityId, [key], time, {
      transportSequence: 1000000,
      entryOrder: 0,
    }).reasons,
  ).toEqual(["pose:provider-death-revive-lifecycle-unimplemented"]);
  expect(world.viewerPose(entityId, [key], time + 0.5).resolved).toBe(false);
});
test("mutable rendered clips/catalogs and transferred copies cannot alter another world's pose content", () => {
  const expected = worldFor().viewerPose(entityId, [key], time),
    entry = assets.createEntry(entityId),
    bundle = assets.serialize();
  entry.catalog.joints[0] = "changed";
  for (const pose of entry.poseAssets.values())
    for (const track of pose.tracks) track.values.fill(9999);
  bundle.packages["vendor/three.core.js"].fill(0);
  expect(worldFor().viewerPose(entityId, [key], time)).toEqual(expected);
});
test("creation/request comparisons preserve same-packet entry ordering without admitting unsupported scalar request entries", () => {
  const creation = { time: 0, transportSequence: 15, entryOrder: 0 };
  expect(
    compareLatestViewerPoseRecords({ ...creation, entryOrder: 1 }, creation),
  ).toBeGreaterThan(0);
  expect(
    compareLatestViewerPoseRecords(creation, { ...creation, entryOrder: 1 }),
  ).toBeLessThan(0);
  const invalid = structuredClone(report);
  invalid.resourceRequests[0].entryOrder = 1;
  expect(() => worldFor(invalid)).toThrow("Original resource request identity");
});
test("rendered model content must equal the pinned hierarchy source, independently of joint names and defaults", () => {
  const entry = assets.createEntry(entityId);
  entry.modelSha256 = "0".repeat(64);
  expect(() => worldFor().bindViewerPoseActor(entityId, entry)).toThrow(
    "Rendered viewer actor differs",
  );
});
test("root-only and full-bone caches preserve exact results through mixed requests and backward seeks", () => {
  const world = worldFor(),
    first = world.viewerPose(entityId, [0], time),
    bone = world.viewerPose(entityId, [key], time),
    again = world.viewerPose(entityId, [0], time);
  expect(first).toEqual(again);
  expect(world.viewerPoseMetrics()).toEqual({ poseUpdates: 2, cacheHits: 1 });
  expect(bone).toEqual(worldFor().viewerPose(entityId, [key], time));
  world.viewerPose(entityId, [0], time - 0.5);
  expect(world.viewerPose(entityId, [key], time)).toEqual(bone);
  expect(world.viewerPose(entityId, [0], time)).toEqual(first);
});
