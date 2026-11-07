import { expect, test } from "bun:test";
import { sha256 } from "./structural-comparison.mjs";
import { directNavgridTransform } from "./latest-direct-navgrid-transform.mjs";
import {
  createDirectNavScene,
  createLatestDirectNavScene,
  validateDirectNavSceneSource,
  isLatestDirectNavScene,
} from "./latest-direct-nav-scene.mjs";
import {
  DIRECT_NAV_SCENE_POLICY,
  DIRECT_NAV_SCENE_OMISSIONS,
} from "./latest-direct-nav-scene-contract.mjs";
import {
  createDirectNavSceneMaterialOwner,
  directNavSceneMaterialAdmission,
} from "./latest-direct-nav-scene-material.mjs";
import { validateDirectNavSceneGpuPasses } from "./latest-direct-nav-scene-gpu.mjs";

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v));
async function fixture() {
  const scene = {
      schema: 1,
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      map: {
        id: 12,
        variant: "supplied-test",
        selection: "Explicit test scene",
        navPath: "test-navigation",
        heightGrid: { sourceSha256: "a".repeat(64) },
      },
    },
    rgba = Uint8Array.of(
      0,
      0,
      0,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      0,
      0,
      0,
      255,
    ),
    center = [50, 0, 50],
    extent = [100, 0, 100],
    source = {
      schema: 1,
      kind: "prepared-original-initial-nav-scene",
      build: scene.build,
      protocol: scene.protocol,
      sceneManifestSha256: await sha256(bytes(scene)),
      selectedMap: Object.fromEntries(
        ["id", "variant", "selection", "navPath"].map((k) => [k, scene.map[k]]),
      ),
      navigation: {
        sourceSha256: scene.map.heightGrid.sourceSha256,
        width: 2,
        height: 2,
        rgbaHex: rgba.toHex(),
        rgbaSha256: await sha256(rgba),
        cellFlagsHex: "0200000000000200",
        cellSize: 50,
        origin: [0, 0, 0],
        center,
        extent,
        transformHex: new Uint8Array(
          directNavgridTransform({ center, extent }).buffer,
        ).toHex(),
      },
      proofs: Object.fromEntries(
        [
          "sourceNativeSha256",
          "sourceComparisonSha256",
          "producerComparisonSha256",
          "producerGpuReplaySha256",
        ].map((k) => [k, "b".repeat(64)]),
      ),
    };
  const args = {
    sceneManifestBytes: bytes(scene),
    sourcePackageBytes: bytes(source),
    expectedPackageSha256: await sha256(bytes(source)),
    policy: DIRECT_NAV_SCENE_POLICY,
  };
  return { scene, source, args, view: await createDirectNavScene(args) };
}
const requiredScene = {
  blocks: [
    {
      requiredMembers: [
        {
          name: "NAV_GRID_XFORM",
          scalar: "float",
          size: 16,
          rows: 1,
          columns: 4,
        },
      ],
    },
  ],
  textures: [
    { name: "NAVMESH_MASK_TEXTURE_SharedTexture", dimension: "texture2d" },
  ],
};

test("selected scene, asset bytes, initial cell flags and transform remain one content identity", async () => {
  const { scene, source, args, view } = await fixture();
  expect(isLatestDirectNavScene(view)).toBe(true);
  expect(isLatestDirectNavScene({ ...view })).toBe(false);
  for (const mutate of [
    (s) => (s.build = "other"),
    (s) => (s.protocol = "other"),
    (s) => (s.sceneManifestSha256 = "0".repeat(64)),
    (s) => (s.selectedMap.variant = "other"),
    (s) => (s.selectedMap.navPath = "other"),
    (s) => (s.navigation.sourceSha256 = "c".repeat(64)),
    (s) => (s.navigation.width = 3),
    (s) => (s.navigation.origin[0] = 1),
    (s) => (s.navigation.center[0] = 51),
    (s) => (s.navigation.extent[2] = 101),
    (s) => (s.navigation.transformHex = "0".repeat(32)),
    (s) => (s.navigation.rgbaHex = "ff" + s.navigation.rgbaHex.slice(2)),
    (s) =>
      (s.navigation.cellFlagsHex = "0000" + s.navigation.cellFlagsHex.slice(4)),
    (s) => (s.proofs = {}),
  ]) {
    const changed = structuredClone(source);
    mutate(changed);
    expect(() =>
      validateDirectNavSceneSource(changed, scene, source.sceneManifestSha256),
    ).toThrow();
  }
  await expect(
    createDirectNavScene({
      ...args,
      sourcePackageBytes: bytes({ ...source, schema: 2 }),
    }),
  ).rejects.toThrow("package changed");
  await expect(
    createDirectNavScene({ ...args, policy: undefined }),
  ).rejects.toThrow("Explicit partial");
  // The actual latest loader always uses its compiled pin, ignoring caller overrides.
  await expect(createLatestDirectNavScene(args)).rejects.toThrow(
    "package changed",
  );
  const changed = structuredClone(source);
  changed.navigation.rgbaSha256 = "c".repeat(64);
  await expect(
    createDirectNavScene({
      ...args,
      sourcePackageBytes: bytes(changed),
      expectedPackageSha256: await sha256(bytes(changed)),
    }),
  ).rejects.toThrow("surface hash differs");
});

test("synchronous timed submission rejects partial passes and invalidates backwards-seek bindings", async () => {
  const { view } = await fixture();
  let passes = 5,
    fail = false,
    calls = 0;
  const texture = {},
    owner = createDirectNavSceneMaterialOwner({
      worldNavScene: view,
      execute: ({ frame }) => {
        calls++;
        if (fail) throw Error("Actual pass failure");
        return {
          texture,
          width: frame.metadata.width,
          height: frame.metadata.height,
          format: "bgra8-unorm",
          finishedPasses: passes,
          frameSequence: frame.sequence,
          replayTime: frame.replayTime,
          sourcePackageSha256: frame.metadata.sourcePackageSha256,
          sourceInitialized: true,
        };
      },
    }),
    forward = view.frame({ time: 1 }),
    binding = owner.renderSync(forward);
  expect(owner.renderSync(forward)).toBe(binding);
  expect(calls).toBe(1);
  const backwards = view.frame({ time: 0.25 });
  passes = 4;
  expect(() => owner.renderSync(backwards)).toThrow("five-pass");
  expect(() =>
    owner.inputs(binding, { replayTime: 1, policy: DIRECT_NAV_SCENE_POLICY }),
  ).toThrow("Current");
  passes = 5;
  fail = true;
  expect(() => owner.renderSync(backwards)).toThrow("Actual pass failure");
  fail = false;
  const current = owner.renderSync(backwards);
  expect(
    owner.inputs(current, { replayTime: 0.25, policy: DIRECT_NAV_SCENE_POLICY })
      .textures.NAVMESH_MASK_TEXTURE_SharedTexture.texture,
  ).toBe(texture);
  expect(() =>
    owner.inputs(current, { replayTime: 1, policy: DIRECT_NAV_SCENE_POLICY }),
  ).toThrow("replay time");
  const asynchronous = createDirectNavSceneMaterialOwner({
    worldNavScene: view,
    execute: async () => ({}),
  });
  expect(() => asynchronous.renderSync(backwards)).toThrow("Synchronous");
});

test("static source epoch is explicit; backward seeks and camera redraws never invent dynamic mutations", async () => {
  const { view } = await fixture(),
    other = (await fixture()).view;
  expect(view.inspect().omissions).toEqual([...DIRECT_NAV_SCENE_OMISSIONS]);
  expect(view.inspect().scope.producerCommandsAreRenderedCoverage).toBe(false);
  expect(view.recordedStateRequirements()).toContain(
    "scene:nav-time-addressable-dynamic-cell-source",
  );
  const init = view.initialization();
  expect(init.plan.upload.target).toBe("mask-a");
  expect(init.plan.lastUpdate).toBe(0);
  init.plan.upload.bytes.fill(99);
  expect(view.initialization().plan.upload.bytes).not.toEqual(
    init.plan.upload.bytes,
  );
  const token = view.frame({ time: 69 }),
    before = view.inspectFrame(token);
  const backward = view.inspectFrame(view.frame({ time: 1.25 }));
  expect(backward.plan.passes[0].parameters[0]).toBe(
    Math.fround(Math.fround(1.2) * Math.fround(1.25)),
  );
  expect(backward.plan.lastUpdate).toBe(0);
  expect(backward.plan.upload).toBeNull();
  expect(view.inspectFrame(view.frame({ time: 69 })).plan).toEqual(before.plan);
  before.transformBytes.fill(0);
  expect(view.inspectFrame(token).transformBytes).not.toEqual(
    before.transformBytes,
  );
  expect(() => other.inspectFrame(token)).toThrow("another scene");
  expect(() => view.inspectFrame({})).toThrow("forged");
  for (const time of [-1, NaN, Infinity, "69", undefined])
    expect(() => view.frame({ time })).toThrow();
});

test("navigation material inputs require a completed same-time output and invalidate reused targets", async () => {
  const { view } = await fixture(),
    calls = [],
    texture = { testGpuObject: true };
  const owner = createDirectNavSceneMaterialOwner({
    worldNavScene: view,
    execute: async (job) => {
      calls.push(job);
      return {
        texture,
        width: 8,
        height: 8,
        format: "bgra8-unorm",
        finishedPasses: 5,
        frameSequence: job.frame.sequence,
        replayTime: job.frame.replayTime,
        sourcePackageSha256: job.frame.metadata.sourcePackageSha256,
        sourceInitialized: true,
      };
    },
  });
  expect(directNavSceneMaterialAdmission({ requiredScene }).reasons).toEqual([
    "scene:nav-owned-world-resource-and-renderer-output",
  ]);
  expect(
    directNavSceneMaterialAdmission({ requiredScene, owner }).reasons,
  ).toEqual(["scene:nav-output-not-submitted-for-current-frame"]);
  const token = view.frame({ time: 69 }),
    binding = await owner.render(token);
  expect(await owner.render(token)).toBe(binding);
  expect(calls).toHaveLength(1);
  expect(calls[0].initialization.plan.upload.bytes).toBeInstanceOf(Uint8Array);
  const result = directNavSceneMaterialAdmission({
    requiredScene,
    owner,
    binding,
    replayTime: 69,
    policy: DIRECT_NAV_SCENE_POLICY,
  });
  expect(
    result.inputs.textures.NAVMESH_MASK_TEXTURE_SharedTexture.texture,
  ).toBe(texture);
  expect(result.inputs.scope.renderedEffectCoverage).toBe(false);
  expect(result.inputs.omissions).toEqual([...DIRECT_NAV_SCENE_OMISSIONS]);
  expect(() =>
    owner.inputs(binding, { replayTime: 70, policy: DIRECT_NAV_SCENE_POLICY }),
  ).toThrow("replay time");
  expect(() =>
    owner.inputs(binding, { replayTime: 69, policy: "recorded" }),
  ).toThrow("policy");
  await owner.render(view.frame({ time: 1 }));
  expect(calls[1].initialization).toBeNull();
  expect(() =>
    owner.inputs(binding, { replayTime: 69, policy: DIRECT_NAV_SCENE_POLICY }),
  ).toThrow("Current");
  expect(() => owner.render({})).toThrow("forged");
  expect(
    directNavSceneMaterialAdmission({
      requiredScene: { blocks: [], textures: [] },
    }).applicable,
  ).toBe(false);
  expect(() =>
    directNavSceneMaterialAdmission({
      requiredScene: { ...requiredScene, textures: [] },
      owner,
    }),
  ).toThrow("paired");
});

test("failed and incomplete GPU submissions cannot publish navigation material inputs", async () => {
  const { view } = await fixture();
  let reject = true;
  const owner = createDirectNavSceneMaterialOwner({
    worldNavScene: view,
    execute: async (job) => {
      if (reject)
        return {
          texture: {},
          width: 8,
          height: 8,
          format: "bgra8-unorm",
          finishedPasses: 4,
        };
      return {
        texture: {},
        width: 8,
        height: 8,
        format: "bgra8-unorm",
        finishedPasses: 5,
        frameSequence: job.frame.sequence,
        replayTime: job.frame.replayTime,
        sourcePackageSha256: job.frame.metadata.sourcePackageSha256,
        sourceInitialized: true,
      };
    },
  });
  const token = view.frame({ time: 2 });
  await expect(owner.render(token)).rejects.toThrow("five-pass");
  expect(() =>
    owner.inputs({}, { replayTime: 2, policy: DIRECT_NAV_SCENE_POLICY }),
  ).toThrow("Current");
  reject = false;
  const binding = await owner.render(token);
  expect(
    owner.inputs(binding, { replayTime: 2, policy: DIRECT_NAV_SCENE_POLICY })
      .uniforms.NAV_GRID_XFORM.length,
  ).toBe(16);
  expect(() =>
    createDirectNavSceneMaterialOwner({
      worldNavScene: { ...view },
      execute: async () => {},
    }),
  ).toThrow("Owned");
});

test("GPU completion cannot be borrowed from another time, source or frame", async () => {
  const { view } = await fixture();
  for (const patch of [
    { frameSequence: -1 },
    { replayTime: 3 },
    { sourcePackageSha256: "c".repeat(64) },
    { sourceInitialized: false },
    { width: 9 },
    { format: "rgba-float" },
  ]) {
    const owner = createDirectNavSceneMaterialOwner({
      worldNavScene: view,
      execute: async ({ frame }) => ({
        texture: {},
        width: 8,
        height: 8,
        format: "bgra8-unorm",
        finishedPasses: 5,
        frameSequence: frame.sequence,
        replayTime: frame.replayTime,
        sourcePackageSha256: frame.metadata.sourcePackageSha256,
        sourceInitialized: true,
        ...patch,
      }),
    });
    await expect(owner.render(view.frame({ time: 2 }))).rejects.toThrow(
      "same-size",
    );
  }
  const frame = view.inspectFrame(view.frame({ time: 2 }));
  expect(validateDirectNavSceneGpuPasses(frame)).toBe(frame.plan);
  for (const mutate of [
    (f) => f.plan.passes.pop(),
    (f) => (f.plan.width = 10),
    (f) => (f.plan.passes[0].samplers.current = "clamp-linear"),
    (f) => (f.plan.passes[1].textures.source = "scratch"),
    (f) => (f.plan.passes[4].parameters[3] = NaN),
    (f) => (f.plan.upload = { target: "mask-a", bytes: new Uint8Array(64) }),
  ]) {
    const changed = structuredClone(frame);
    mutate(changed);
    expect(() => validateDirectNavSceneGpuPasses(changed)).toThrow();
  }
});
