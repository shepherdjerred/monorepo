// Exercise the actual renderer loader with pinned THREE and local static assets.
// Material objects and texture bytes are observed; no GL submission is claimed.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { LatestDirectEffectRuntime } from "../latest-direct-effect-runtime.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const trailOnly = process.argv.includes("--trail");
const navCameraOnly = process.argv.includes("--nav-camera");
if (trailOnly && navCameraOnly)
  throw Error("Distinct renderer cohorts required");
const assetOrigin =
  process.argv[3] && !process.argv[3].startsWith("--")
    ? new URL(process.argv[3])
    : null;
const root = resolve(import.meta.dir, ".."),
  assets = resolve(cache, "public");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Renderer input changed during verification: ${path}`);
  inputs[path] = hash;
  return bytes;
};
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(root, "latest-direct-effect-renderer.mjs"),
    resolve(root, "latest-direct-effect-package.mjs"),
    resolve(root, "latest-direct-nav-scene.mjs"),
  ],
  raw,
);
const admission = navCameraOnly
  ? {
      inputs: { producers: {} },
      definitions: [
        {
          id: "champions/karthus/10/8ad0cea5",
          supported: [2, 4, 5, 6, 7, 9, 10],
        },
      ],
    }
  : trailOnly
    ? {
        inputs: { producers: {} },
        definitions: [
          { id: "champions/vladimir/39/9fbafd14", supported: [0, 1, 9] },
        ],
      }
    : JSON.parse(
        new TextDecoder().decode(
          await raw(`${cache}/research/direct-effects.json`),
        ),
      );
for (const [file, hash] of Object.entries(admission.inputs.producers))
  if ((await sha256(await raw(resolve(root, file)))) !== hash)
    throw Error(`Stale direct admission: ${file}`);
for (const file of [
  "latest-direct-effect-renderer.mjs",
  "latest-parent-renderer.mjs",
  "latest-vfx-bound-renderer.mjs",
  "latest-vfx-renderer.mjs",
  "latest-parent-render-frame.mjs",
  "latest-trail-renderer.mjs",
  "latest-direct-effect-draw.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-orientation.mjs",
  "latest-direct-effect-integrated-rotation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
  "latest-direct-effect-trail.mjs",
  "latest-direct-effect-trail-math.mjs",
  "latest-direct-effect-trail-table.mjs",
  "latest-direct-effect-package.mjs",
  "tools/inspect-direct-renderer-loading.mjs",
])
  await raw(resolve(root, file));
const manifestBytes = await raw(`${assets}/latest-effects/manifest.json`);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const effectIds = admission.definitions
  .filter((d) => d.supported.length)
  .map((d) => d.id);
const entry = resolve(root, "latest-direct-effect-renderer.mjs");
const bundle = await Bun.build({
  entrypoints: ["renderer-loading-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^renderer-loading-entry$/ }, () => ({
          path: "entry",
          namespace: "renderer-loading",
        }));
        build.onLoad({ filter: /.*/, namespace: "renderer-loading" }, () => ({
          loader: "js",
          contents: [
            entry,
            resolve(root, "latest-direct-effect-package.mjs"),
            resolve(root, "latest-direct-nav-scene.mjs"),
          ]
            .map(
              (path) =>
                `export * from ${JSON.stringify(path.replaceAll("\\", "/"))};`,
            )
            .join("\n"),
        }));
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${assets}/vendor/three.module.js`,
        }));
      },
    },
  ],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw new AggregateError(bundle.logs, "Direct renderer loader bundle failed");
const bundlePath = `${cache}/research/direct-${trailOnly ? "trail-" : ""}renderer-loading.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
await raw(bundlePath);
for (const file of [
  "latest-direct-effect-renderer.mjs",
  "latest-parent-renderer.mjs",
  "latest-vfx-bound-renderer.mjs",
  "latest-vfx-renderer.mjs",
  "latest-parent-render-frame.mjs",
  "latest-trail-renderer.mjs",
  "latest-direct-effect-draw.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-trail.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-trail-math.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-trail-table.mjs",
  "latest-direct-effect-orientation.mjs",
  "tools/inspect-direct-renderer-loading.mjs",
  "latest-direct-effect-integrated-rotation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
])
  await raw(resolve(root, file));
const {
  LatestDirectEffectRenderer,
  loadLatestDirectEffectPackage,
  createLatestDirectNavScene,
} = await import(pathToFileURL(bundlePath).href);
const prepared = await loadLatestDirectEffectPackage({
  load: (path) => raw(resolve(assets, path)),
  manifestBytes,
  effectIds,
});
if (trailOnly)
  for (const [id, d] of prepared.definitions)
    prepared.definitions.set(id, {
      ...d,
      emitters: d.emitters.filter((e) => e.primitive === "camera-trail"),
    });
const hasNav = [...prepared.definitions.values()].some((d) =>
  d.emitters.some((e) => e.navGroundProgram),
);
const navigation = hasNav
  ? {
      materials: prepared.navGroundMaterials,
      worldNavScene: await createLatestDirectNavScene({
        sceneManifestBytes: await raw(`${assets}/latest-scene/manifest.json`),
        sourcePackageBytes: await raw(
          `${assets}/latest-direct-nav-scene/package.json`,
        ),
        policy: "selected-installed-scene-initial-navigation-replay-zero-v1",
      }),
      loaderOnly: true,
      provider: null,
      gpuRenderer: null,
    }
  : null;
const THREE = await import(
  pathToFileURL(`${assets}/vendor/three.module.js`).href
);
const requests = [];
const renderer = new LatestDirectEffectRenderer(
  new THREE.Group(),
  manifest,
  manifestBytes,
  { navigation },
);
renderer.checked = async (path, expected) => {
  if (!path.startsWith("/assets/"))
    throw Error("Unexpected renderer resource root");
  const local = resolve(assets, path.slice("/assets/".length));
  if (!local.startsWith(assets + sep))
    throw Error("Renderer resource escaped the asset directory");
  const bytes = await raw(local);
  if (expected && (await sha256(bytes)) !== expected)
    throw Error("Renderer resource hash differs");
  if (assetOrigin) {
    const response = await fetch(new URL(path, assetOrigin));
    if (response.status !== 200)
      throw Error(`Renderer asset HTTP ${response.status}: ${path}`);
    if (
      (await sha256(new Uint8Array(await response.arrayBuffer()))) !==
      (await sha256(bytes))
    )
      throw Error(
        `Served renderer asset differs from its static package: ${path}`,
      );
  }
  requests.push({ path, bytes: bytes.byteLength });
  return bytes;
};
let summary;
try {
  await renderer.loadDefinitions(prepared.definitions);
  const expected = [...prepared.definitions.values()]
    .flatMap((d) =>
      d.emitters
        .filter(
          (e) =>
            !e.navGroundProgram &&
            !["static-mesh", "ray"].includes(e.primitive),
        )
        .map((e) => e.materialKey),
    )
    .sort();
  const expectedStatic = [...prepared.definitions.values()]
    .flatMap((d) =>
      d.emitters
        .filter((e) => e.primitive === "static-mesh")
        .map((e) => e.materialKey),
    )
    .sort();
  const loadedStatic = [
    ...(renderer.staticMeshRenderer?.bindings.keys() ?? []),
  ].sort();
  assert.deepEqual(
    loadedStatic,
    expectedStatic,
    "Exactly admitted static mesh materials must load separately",
  );
  const expectedRay = [...prepared.definitions.values()]
    .flatMap((d) =>
      d.emitters.filter((e) => e.primitive === "ray").map((e) => e.materialKey),
    )
    .sort();
  const loadedRay = [...(renderer.rayRenderer?.bindings.keys() ?? [])].sort();
  assert.deepEqual(
    loadedRay,
    expectedRay,
    "Exactly admitted Ray materials must load separately",
  );
  const loaded = [...renderer.gpuMaterials.keys()].sort();
  const expectedNav = [...prepared.definitions.values()]
    .flatMap((d) =>
      d.emitters.filter((e) => e.navGroundProgram).map((e) => e.materialKey),
    )
    .sort();
  assert.deepEqual(
    [...(renderer.navGroundRenderer?.bindings.keys() ?? [])].sort(),
    expectedNav,
    "Exact navigation materials must load without faking GPU completion",
  );
  if (JSON.stringify(loaded) !== JSON.stringify(expected))
    throw Error(
      "Direct renderer did not load exactly its admitted component materials",
    );
  const groundPrograms = [...prepared.definitions.values()].flatMap(
    (definition) =>
      definition.emitters.filter(
        (emitter) =>
          emitter.groundLayer &&
          !emitter.navGroundProgram &&
          !["static-mesh", "ray"].includes(emitter.primitive),
      ),
  );
  for (const program of groundPrograms) {
    const binding = renderer.gpuMaterials.get(program.materialKey);
    assert.equal(binding.prepared.environment.pass, 5);
    assert.equal(binding.prepared.materialPolicy, program.materialPolicy);
    const resources = Object.entries(binding.prepared.textures).filter(
      ([, resource]) => resource.kind === "native-ground-all-vision",
    );
    assert.equal(resources.length, 1);
    const [name, resource] = resources[0];
    const texture = binding.material.uniforms[name].value;
    assert.equal(texture.image.width, 1);
    assert.equal(texture.image.height, 1);
    assert.deepEqual([...texture.image.data], [255, 255, 255, 255]);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
    assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    await assert.rejects(
      () => renderer.gpuTexture({ ...resource, rgbaHex: "00000000" }),
      /Original native ground all-vision texture identity required/,
    );
  }
  const depthBiasPrograms = [...prepared.definitions.values()].flatMap(
    (definition) =>
      definition.emitters
        .filter((emitter) => emitter.depthBiasProgram)
        .map((emitter) => ({ definitionId: definition.id, emitter })),
  );
  for (const { emitter } of depthBiasPrograms) {
    const binding = emitter.navGroundProgram
      ? renderer.navGroundRenderer?.bindings.get(emitter.materialKey)
      : renderer.gpuMaterials.get(emitter.materialKey);
    assert.ok(binding);
    assert.equal(
      binding.material.polygonOffset,
      emitter.depthBiasProgram.enabled,
    );
    assert.ok(
      Object.is(
        binding.material.polygonOffsetFactor,
        emitter.depthBiasProgram.slope,
      ),
    );
    assert.ok(
      Object.is(
        binding.material.polygonOffsetUnits,
        emitter.depthBiasProgram.constant,
      ),
    );
    assert.deepEqual(
      emitter.navGroundProgram
        ? binding.program.depthBiasProgram
        : binding.depthBiasProgram,
      emitter.depthBiasProgram,
    );
  }
  if (navCameraOnly) {
    assert.deepEqual(
      [...renderer.navGroundRenderer.bindings.keys()].sort(),
      [4, 5, 6, 7].map((index) => `champions/karthus/10/8ad0cea5:${index}`),
    );
    assert.ok(renderer.gpuMaterials.has("champions/karthus/10/8ad0cea5:9"));
    assert.equal(
      renderer.gpuMaterials.has("champions/karthus/10/8ad0cea5:7"),
      false,
    );
    assert.equal(
      renderer.navGroundRenderer.bindings.get("champions/karthus/10/8ad0cea5:7")
        .material.polygonOffset,
      true,
    );
  }
  const allDefinitionMaterials = [...renderer.bridge.materials.values()].filter(
    (b) => renderer.loadedEffects.has(b.prepared.effectId),
  );
  // The focused camera cohort checks distinct navigation/conventional owners;
  // the original broad cohort additionally checks excluded ordinary siblings.
  if (!navCameraOnly && loaded.length >= allDefinitionMaterials.length)
    throw Error("Loader control did not exercise excluded sibling materials");
  const selectedRequests = requests.slice();
  const definition = [...prepared.definitions.values()].find((d) =>
    d.emitters.some(
      (e) =>
        !e.navGroundProgram && !["static-mesh", "ray"].includes(e.primitive),
    ),
  );
  const program = definition.emitters.find(
    (e) => !e.navGroundProgram && !["static-mesh", "ray"].includes(e.primitive),
  );
  let trailDraw = null;
  if (trailOnly) {
    const proof = JSON.parse(
      new TextDecoder().decode(
        await raw(`${cache}/research/direct-trail-schedule-comparison.json`),
      ),
    );
    for (const [path, h] of Object.entries(proof.inputs))
      if ((await sha256(await raw(path))) !== h)
        throw Error("Trail renderer comparison input differs");
    if (proof.mismatches.length)
      throw Error("Native-compared trail geometry required");
    const sample = proof.comparisons.find(
      (c) => c.effectId === definition.id && c.emitterIndex === program.index,
    )?.visual.geometry[0];
    if (!sample) throw Error("Native-compared trail sample missing");
    const vertexBytes = Uint8Array.from(Buffer.from(sample.verticesHex, "hex")),
      indexBytes = Uint8Array.from(Buffer.from(sample.indicesHex, "hex"));
    trailDraw = {
      primitive: "camera-trail",
      particleCount: vertexBytes.length / 56,
      vertexBytes,
      indices: new Uint16Array(indexBytes.buffer),
    };
  }
  const camera = new THREE.PerspectiveCamera();
  for (const generation of [1, 2, 2]) {
    renderer.commitDirect(
      {
        time: generation,
        metrics: {},
        draws: [
          {
            sourceEventId: "supplied-generation-control",
            generation,
            definitionId: definition.id,
            emitterId: program.index,
            materialKey: program.materialKey,
            particleCount: 1,
            positions: new Float32Array([
              -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
            ]),
            colors: new Float32Array(16).fill(1),
            uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
            ...(trailDraw ?? { particleUV: new Uint16Array([0, 0, 0x3c00]) }),
          },
        ],
      },
      camera,
    );
    // Invoke the actual callback solely to check bookkeeping, without GL.
    for (const mesh of renderer.directMeshes.values()) {
      if (trailOnly)
        assert.equal(
          mesh.geometry.attributes.a_POSITION.count,
          trailDraw.particleCount * 2,
        );
      mesh.onAfterRender();
      mesh.onAfterRender();
    }
  }
  const callbackCoverage = renderer.submissionCoverage();
  const generationStats = { ...renderer.stats };
  for (const { definitionId, emitter } of depthBiasPrograms) {
    // Loader-only navigation cannot publish a GPU output or visible combat
    // mesh; its material state is checked above and real submission separately.
    if (emitter.navGroundProgram) continue;
    renderer.commitDirect(
      {
        time: 2,
        metrics: {},
        draws: [
          {
            sourceEventId: `supplied-depth-bias-loader-control:${definitionId}:${emitter.index}`,
            generation: 1,
            definitionId,
            emitterId: emitter.index,
            materialKey: emitter.materialKey,
            particleCount: 1,
            positions: new Float32Array([
              -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
            ]),
            colors: new Float32Array(16).fill(1),
            uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
            particleUV: new Uint16Array([0, 0, 0x3c00]),
          },
        ],
      },
      camera,
    );
    const mesh = [...renderer.directMeshes.values()].find(
      (candidate) =>
        candidate.material ===
        renderer.gpuMaterials.get(emitter.materialKey).material,
    );
    assert.ok(mesh);
    assert.doesNotThrow(() =>
      mesh.onBeforeRender({
        capabilities: { reversedDepthBuffer: false },
        state: { buffers: { depth: { getReversed: () => false } } },
      }),
    );
    assert.throws(
      () =>
        mesh.onBeforeRender({
          capabilities: { reversedDepthBuffer: true },
          state: { buffers: { depth: { getReversed: () => false } } },
        }),
      /non-reversed renderer depth/,
    );
  }
  let staticRuntimeControl = null;
  if (expectedStatic.length) {
    const selected = [...prepared.definitions.values()].find((d) =>
      d.emitters.some((e) => e.primitive === "static-mesh"),
    );
    const runtime = new LatestDirectEffectRuntime({
      ...prepared.contract,
      replayHash: "a".repeat(64),
      definitions: new Map([[selected.id, selected]]),
      kernels: prepared.kernels,
      events: [
        {
          id: "supplied-loader-retained-runtime",
          kind: "create",
          origin: "network-effect",
          time: 0,
          transportSequence: 1,
          entryOrder: 0,
          entityId: 1,
          definitionId: selected.id,
          seedHex: "0000000000000001",
        },
      ],
      world: {
        placement: () => ({
          resolved: true,
          position: [0, 0, 0],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          boundObjectSize: 0,
        }),
      },
    });
    runtime.advanceTo(0.1);
    const packet = runtime.generateDraws({
      right: [1, 0, 0],
      up: [0, 0, 1],
      axis: [0, 1, 0],
      position: [0, 1000, 0],
    });
    const meshDraws = packet.draws.filter((d) => d.primitive === "static-mesh");
    assert.ok(meshDraws.length > 0);
    assert.ok(
      packet.draws.some((d) => d.primitive !== "static-mesh"),
      "Full installed definition must exercise both mesh and conventional components",
    );
    renderer.commitDirect(packet, camera);
    assert.equal(
      renderer.staticMeshRenderer.meshes.size,
      meshDraws.reduce((n, d) => n + d.particleCount, 0),
    );
    for (const mesh of renderer.staticMeshRenderer.meshes.values()) {
      assert.equal(mesh.geometry.index.count, 480);
      mesh.onAfterRender();
      mesh.visible = false;
      const count = renderer.submissionCoverage().submittedInstances;
      mesh.onAfterRender();
      assert.equal(renderer.submissionCoverage().submittedInstances, count);
      mesh.visible = true;
    }
    for (const mesh of renderer.directMeshes.values()) mesh.onAfterRender();
    const row = renderer
      .submissionCoverage()
      .rows.find((r) => r.sourceEventId === "supplied-loader-retained-runtime");
    assert.ok(row);
    assert.ok(meshDraws.every((d) => row.emitters.includes(d.emitterId)));
    staticRuntimeControl = {
      realRetainedRuntimePacket: true,
      conventionalComponents: packet.draws.length - meshDraws.length,
      staticComponents: meshDraws.length,
      particles: meshDraws.reduce((n, d) => n + d.particleCount, 0),
      sharedOwnershipAndSubmission: true,
      zeroGpuClaim: true,
    };
    renderer.commitDirect({ ...packet, draws: [] }, camera);
    assert.equal(renderer.staticMeshRenderer.meshes.size, 0);
  }
  let rayRuntimeControl = null;
  if (expectedRay.length) {
    const selected = [...prepared.definitions.values()].find((d) =>
      d.emitters.some((e) => e.primitive === "ray"),
    );
    const runtime = new LatestDirectEffectRuntime({
      ...prepared.contract,
      replayHash: "a".repeat(64),
      definitions: new Map([[selected.id, selected]]),
      kernels: prepared.kernels,
      events: [
        {
          id: "supplied-loader-ray-runtime",
          kind: "create",
          origin: "network-effect",
          time: 0,
          transportSequence: 1,
          entryOrder: 0,
          entityId: 1,
          definitionId: selected.id,
          seedHex: "0000000000000001",
        },
      ],
      world: {
        placement: () => ({
          resolved: true,
          position: [0, 0, 0],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          boundObjectSize: 0,
        }),
      },
    });
    runtime.advanceTo(0.1);
    const packet = runtime.generateDraws({
        right: [1, 0, 0],
        up: [0, 0, 1],
        axis: [0, 1, 0],
        position: [0, 1000, 1000],
      }),
      rayDraws = packet.draws.filter((d) => d.primitive === "ray");
    assert.equal(rayDraws.length, expectedRay.length);
    assert.ok(
      packet.draws.some((d) => d.primitive !== "ray"),
      "Actual installed Ray definition must retain conventional siblings",
    );
    renderer.commitDirect(packet, camera);
    assert.equal(renderer.rayRenderer.meshes.size, rayDraws.length);
    for (const mesh of renderer.rayRenderer.meshes.values()) {
      assert.ok(mesh.geometry.index.count > 0);
      mesh.onAfterRender();
      mesh.visible = false;
      const count = renderer.submissionCoverage().submittedInstances;
      mesh.onAfterRender();
      assert.equal(renderer.submissionCoverage().submittedInstances, count);
      mesh.visible = true;
    }
    const row = renderer
      .submissionCoverage()
      .rows.find((r) => r.sourceEventId === "supplied-loader-ray-runtime");
    assert.ok(row);
    assert.ok(rayDraws.every((d) => row.emitters.includes(d.emitterId)));
    rayRuntimeControl = {
      realRetainedRuntimePacket: true,
      rayComponents: rayDraws.length,
      packedParticleCount: rayDraws.reduce((n, d) => n + d.particleCount, 0),
      conventionalComponents: packet.draws.length - rayDraws.length,
      sharedOwnershipAndSubmission: true,
      zeroGpuClaim: true,
    };
    renderer.commitDirect({ ...packet, draws: [] }, camera);
    assert.equal(renderer.rayRenderer.meshes.size, 0);
  }
  if (trailOnly) {
    assert.equal(renderer.stats.visibleQuads, 0);
    assert.equal(renderer.stats.visibleTrailPoints, trailDraw.particleCount);
  }
  if (
    callbackCoverage.submittedInstances !== 2 ||
    callbackCoverage.distinctSubmittedDefinitions !== 1 ||
    JSON.stringify(callbackCoverage.rows.map((row) => row.generation)) !==
      "[1,2]" ||
    callbackCoverage.rows.some(
      (row) =>
        row.sourceEventId !== "supplied-generation-control" ||
        row.emitters.length !== 1,
    ) ||
    generationStats.visibleEffectInstances !== 1 ||
    generationStats.visibleMissiles !== null
  )
    throw Error(
      "Renderer submission bookkeeping collapsed creation generations or duplicated callbacks",
    );
  if (trailOnly) {
    const supplied = (overrides = {}) => ({
      sourceEventId: "trail-zero-primitive-control",
      generation: 1,
      definitionId: definition.id,
      emitterId: program.index,
      materialKey: program.materialKey,
      ...trailDraw,
      ...overrides,
    });
    renderer.commitDirect(
      {
        time: 3,
        metrics: {},
        draws: [
          supplied({
            particleCount: 1,
            vertexBytes: trailDraw.vertexBytes.slice(0, 56),
            indices: new Uint16Array(),
          }),
        ],
      },
      camera,
    );
    let mesh = [...renderer.directMeshes.values()][0];
    assert.equal(mesh.visible, false);
    assert.equal(mesh.geometry.index.count, 0);
    mesh.onAfterRender();
    assert.equal(renderer.submissionCoverage().submittedInstances, 2);
    assert.equal(renderer.stats.visibleEffectInstances, 0);
    assert.equal(renderer.stats.visibleTrailPoints, 0);
    renderer.commitDirect(
      {
        time: 3.1,
        metrics: {},
        draws: [
          supplied({
            particleCount: 2,
            vertexBytes: trailDraw.vertexBytes.slice(0, 112),
            indices: new Uint16Array([2, 0, 1, 2, 1, 3]),
          }),
        ],
      },
      camera,
    );
    mesh = [...renderer.directMeshes.values()][0];
    assert.equal(mesh.visible, true);
    assert.equal(mesh.geometry.index.count, 6);
    mesh.onAfterRender();
    assert.equal(renderer.submissionCoverage().submittedInstances, 3);
    assert.equal(renderer.stats.visibleTrailPoints, 2);
    renderer.commitDirect(
      {
        time: 3.2,
        metrics: {},
        draws: [
          supplied({
            sourceEventId: "trail-hidden-mesh-control",
            particleCount: 2,
            vertexBytes: trailDraw.vertexBytes.slice(0, 112),
            indices: new Uint16Array([2, 0, 1, 2, 1, 3]),
          }),
        ],
      },
      camera,
    );
    mesh = [...renderer.directMeshes.values()][0];
    mesh.visible = false;
    mesh.onAfterRender();
    assert.equal(renderer.submissionCoverage().submittedInstances, 3);
    mesh.visible = true;
    mesh.onAfterRender();
    assert.equal(renderer.submissionCoverage().submittedInstances, 4);
  }
  // Exercise renderer contract failures with actual THREE geometry/callbacks.
  // These supplied packets do not establish GPU submission or match ownership.
  const contractRenderer = new LatestDirectEffectRenderer(
    new THREE.Group(),
    {},
    new Uint8Array(),
  );
  contractRenderer.ready = true;
  contractRenderer.compiled = new Map(
    ["definition-a", "definition-b"].map((id) => [
      id,
      {
        id,
        emitters: [{ index: 0, materialKey: id + ":0" }],
      },
    ]),
  );
  for (const id of contractRenderer.compiled.keys())
    contractRenderer.gpuMaterials.set(id + ":0", {
      material: new THREE.MeshBasicMaterial(),
      prepared: { suppliedSortPass: 0 },
    });
  const suppliedDraw = (overrides = {}) => ({
    sourceEventId: "source:1",
    generation: 1,
    definitionId: "definition-a",
    emitterId: 0,
    materialKey: "definition-a:0",
    ownerId: null,
    ownershipStatus: "unresolved",
    particleCount: 1,
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
    colors: new Float32Array(16).fill(1),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    particleUV: new Uint16Array([0, 0, 0x3c00]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    ...overrides,
  });
  const commitSupplied = (draws, time = 0) =>
    contractRenderer.commitDirect({ time, draws, metrics: {} }, camera);
  try {
    assert.throws(
      () => commitSupplied([suppliedDraw(), suppliedDraw()]),
      /Duplicate direct draw identity/,
    );
    assert.throws(
      () =>
        commitSupplied([
          suppliedDraw(),
          suppliedDraw({
            sourceEventId: "other",
            positions: new Float32Array(),
          }),
        ]),
      /Malformed direct draw buffers/,
    );
    for (const generation of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(
        () => commitSupplied([suppliedDraw({ generation })]),
        /Unowned direct draw/,
      );
    assert.equal(contractRenderer.directMeshes.size, 0);
    assert.equal(contractRenderer.directOwnership.size, 0);
    assert.equal(contractRenderer.frameMetrics, null);
    const packetDraw = suppliedDraw();
    commitSupplied([packetDraw]);
    const mesh = [...contractRenderer.directMeshes.values()][0];
    const metrics = contractRenderer.frameMetrics;
    const material = mesh.material;
    for (const overrides of [
      { definitionId: "definition-b", materialKey: "definition-b:0" },
      { ownerId: 7 },
      { ownershipStatus: "verified" },
    ])
      assert.throws(
        () => commitSupplied([suppliedDraw(overrides)], 1),
        /Direct instance definition or ownership changed/,
      );
    assert.equal(mesh.material, material);
    assert.equal(contractRenderer.frameMetrics, metrics);
    packetDraw.sourceEventId = "caller-mutated";
    packetDraw.ownerId = 99;
    packetDraw.emitterId = 5;
    mesh.onAfterRender();
    mesh.onAfterRender();
    assert.deepEqual(contractRenderer.submissionCoverage().rows, [
      {
        id: "source:1:1",
        sourceEventId: "source:1",
        generation: 1,
        definitionId: "definition-a",
        ownerId: null,
        ownershipStatus: "unresolved",
        firstTime: 0,
        emitters: [0],
      },
    ]);
    commitSupplied([], 4);
    assert.equal(contractRenderer.directMeshes.size, 0);
    assert.throws(
      () => commitSupplied([suppliedDraw({ ownerId: 7 })], 1),
      /Direct instance definition or ownership changed/,
    );
    commitSupplied([suppliedDraw()], 1);
    [...contractRenderer.directMeshes.values()][0].onAfterRender();
    commitSupplied(
      [
        suppliedDraw({
          generation: 2,
          ownerId: 7,
          ownershipStatus: "supplied",
        }),
      ],
      3,
    );
    [...contractRenderer.directMeshes.values()][0].onAfterRender();
    assert.deepEqual(
      contractRenderer
        .submissionCoverage()
        .rows.map((row) => [row.generation, row.ownerId]),
      [
        [1, null],
        [2, 7],
      ],
    );
    assert.equal(contractRenderer.submissionCoverage().submittedInstances, 2);
    assert.equal(
      contractRenderer.submissionCoverage().visiblePixelVerified,
      false,
    );
    assert.equal(contractRenderer.stats.visibleMissiles, null);
  } finally {
    contractRenderer.dispose();
  }
  const ParentRenderer = Object.getPrototypeOf(LatestDirectEffectRenderer);
  const completeParent = new ParentRenderer(
    new THREE.Group(),
    manifest,
    manifestBytes,
  );
  completeParent.checked = renderer.checked;
  let completeParentMaterials;
  try {
    const effect = "champions/vladimir/39/9fbafd14";
    await completeParent.load([effect]);
    const expectedParent = [...completeParent.bridge.materials.values()]
      .filter((binding) => binding.prepared.effectId === effect)
      .map((binding) => binding.key)
      .sort();
    if (
      !expectedParent.length ||
      JSON.stringify([...completeParent.gpuMaterials.keys()].sort()) !==
        JSON.stringify(expectedParent)
    )
      throw Error("Default complete-parent material loading changed");
    completeParentMaterials = expectedParent.length;
  } finally {
    completeParent.dispose();
  }
  const rejected = [];
  for (const [label, keys] of [
    ["duplicate", [expected[0], expected[0]]],
    ["missing", ["missing/effect:0"]],
    ["foreign-effect", [expected[0]]],
  ]) {
    const candidate = new LatestDirectEffectRenderer(
      new THREE.Group(),
      manifest,
      manifestBytes,
    );
    candidate.checked = renderer.checked;
    const effects =
      label === "foreign-effect"
        ? [...renderer.loadedEffects].filter(
            (id) =>
              id !== renderer.gpuMaterials.get(expected[0]).prepared.effectId,
          )
        : [...renderer.loadedEffects];
    try {
      await Object.getPrototypeOf(
        LatestDirectEffectRenderer.prototype,
      ).load.call(candidate, effects, { materialKeys: keys });
      throw Error("Invalid material selection was accepted");
    } catch (error) {
      if (
        !/unique renderer material keys|absent or belongs to another effect/.test(
          error.message,
        )
      )
        throw error;
      rejected.push(label);
    } finally {
      candidate.dispose();
    }
  }
  summary = {
    admittedMaterialsLoaded:
      loaded.length +
      loadedStatic.length +
      loadedRay.length +
      expectedNav.length,
    admittedNavigationMaterialsLoaded: expectedNav.length,
    navigationControl: {
      loaderOnlyWithoutWebGL: hasNav,
      ownedProgramsAndExactStaticResourcesLoaded: hasNav,
      gpuCompletionForged: false,
      submittedNavigationDraws: 0,
    },
    admittedConventionalMaterialsLoaded: loaded.length,
    admittedStaticMeshMaterialsLoaded: loadedStatic.length,
    admittedRayMaterialsLoaded: loadedRay.length,
    staticRuntimeControl,
    depthBiasPrograms: depthBiasPrograms.map(({ definitionId, emitter }) => ({
      definitionId,
      emitterId: emitter.index,
      materialKey: emitter.materialKey,
      program: emitter.depthBiasProgram,
      actualThreeMaterialStateVerified: true,
    })),
    rayRuntimeControl,
    definitionMaterialsBeforeSelection: allDefinitionMaterials.length,
    omittedSiblingMaterials: allDefinitionMaterials.length - loaded.length,
    definitions: renderer.loadedEffects.size,
    textures: renderer.textures.size,
    uniformGroups: renderer.uniformGroups.size,
    completeParentMaterials,
    generationCallbackControl: {
      distinctInstances: callbackCoverage.submittedInstances,
      generations: callbackCoverage.rows.map((row) => row.generation),
      gpuSubmissionProven: false,
    },
    trailMaterialControl: {
      nativeComparedPackedTrailCommitted: trailOnly,
      trailPoints: trailDraw?.particleCount ?? 0,
      zeroPrimitiveAndHiddenCallbackExcluded: trailOnly,
      gpuSubmissionProven: false,
    },
    ownershipContractControl: {
      duplicateAndMalformedPacketsRejectedBeforeCommit: true,
      instanceDefinitionAndOwnershipImmutableAcrossSeeks: true,
      callbackMetadataIndependentOfCallerMutation: true,
      unknownOwnershipPreserved: true,
      gpuSubmissionProven: false,
    },
    groundMaterialControl: {
      exactPass5AllVisionBindings: groundPrograms.length,
      actualThreeNativeWhiteTexturesVerified: groundPrograms.length,
      corruptWhiteResourceRejected: groundPrograms.length > 0,
      gpuSubmissionProven: false,
      actualTeamVisibilityRecovered: false,
    },
    rejected,
    loadedKeys: loaded,
    requests: selectedRequests,
  };
} finally {
  renderer.dispose();
}
const result = {
  schema: 1,
  kind: "direct-renderer-static-loading-control",
  summary,
  inputs,
  scope: {
    actualThreeMaterialLoader: true,
    servedAssetBytesVerified: assetOrigin !== null,
    browserExecuted: false,
    gpuSubmission: false,
    visiblePixelCoverage: false,
    matchActivation: false,
  },
};
for (const path of Object.keys(inputs)) await raw(path);
const output = navCameraOnly
  ? `${cache}/research/direct-nav-camera-full-renderer-control-v37.json`
  : `${cache}/research/direct-${trailOnly ? "trail-" : ""}renderer-loading.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    { output, ...summary, loadedKeys: undefined, requests: undefined },
    null,
    2,
  ),
);
