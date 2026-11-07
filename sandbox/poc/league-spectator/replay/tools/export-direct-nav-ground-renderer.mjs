// Actual shared package/runtime/THREE ground consumer over explicit placement
// controls. A command-capture host is followed by independent GLES execution.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createThreeBufferSubmissionControl } from "./direct-three-buffer-submission.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  workerPath = process.argv[3] ?? null,
  scenePath = process.argv[4] ?? null,
  inputs = {},
  root = resolve(import.meta.dir, ".."),
  raw = async (path) => {
    path = resolve(path);
    const bytes = await Bun.file(path).bytes(),
      hash = await sha256(bytes);
    if (inputs[path] && inputs[path] !== hash)
      throw Error(`Ground input drift: ${path}`);
    inputs[path] = hash;
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`),
  modules = [
    "latest-direct-effect-package.mjs",
    "latest-direct-effect-runtime.mjs",
    "latest-direct-nav-ground-renderer.mjs",
    "latest-direct-nav-scene-renderer.mjs",
    "latest-direct-nav-scene.mjs",
    "latest-direct-nav-scene-gpu.mjs",
    "latest-direct-effect-draw.mjs",
    "latest-direct-nav-scene-contract.mjs",
  ],
  build = await Bun.build({
    entrypoints: ["nav-ground-control"],
    target: "bun",
    write: false,
    external: ["/assets/*"],
    plugins: [
      {
        name: "single-owned-ground-module-graph",
        setup(build) {
          build.onResolve({ filter: /^nav-ground-control$/ }, () => ({
            path: "entry",
            namespace: "nav-ground-control",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "nav-ground-control" },
            () => ({
              loader: "js",
              contents: modules
                .map(
                  (name) =>
                    `export * from ${JSON.stringify(resolve(root, name).replaceAll("\\", "/"))};`,
                )
                .join("\n"),
            }),
          );
          build.onResolve({ filter: /^three$/ }, () => ({
            path: `${cache}/public/vendor/three.module.js`,
          }));
        },
      },
    ],
  });
if (!build.success)
  throw new AggregateError(build.logs, "Ground command capture bundle failed");
const bundle = `${cache}/research/direct-nav-ground-renderer.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
await raw(bundle);
await raw(`${cache}/public/vendor/three.module.js`);
await raw(`${cache}/public/vendor/three.core.js`);
const threeSubmission = createThreeBufferSubmissionControl(
  new TextDecoder().decode(await raw(`${cache}/public/vendor/three.module.js`)),
);
await captureDirectSourceInputs(
  [import.meta.path, ...modules.map((name) => resolve(root, name))],
  raw,
);
const THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  api = await import(pathToFileURL(bundle).href),
  materialPackages = await Promise.all(
    [
      "latest-direct-nav-ground-materials",
      "latest-direct-nav-camera-materials",
    ].map((folder) => read(`${cache}/public/${folder}/package.json`)),
  ),
  materialPackage = { emitters: materialPackages.flatMap((p) => p.emitters) },
  manifestBytes = await load("latest-effects/manifest.json"),
  prepared = await api.loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: [...new Set(materialPackage.emitters.map((e) => e.effectId))],
  }),
  sceneManifestBytes = await load("latest-scene/manifest.json"),
  sourcePackageBytes = await load("latest-direct-nav-scene/package.json"),
  sourcePackage = JSON.parse(new TextDecoder().decode(sourcePackageBytes)),
  worldNavScene = await api.createLatestDirectNavScene({
    sceneManifestBytes,
    sourcePackageBytes,
    policy: api.DIRECT_NAV_SCENE_POLICY,
  }),
  program = await api.loadDirectNavSceneGpuProgram({ load });
if ((workerPath === null) !== (scenePath === null))
  throw Error(
    "Both actual worker proof and explicit diagnostic projection required",
  );
const worker = workerPath === null ? null : await read(workerPath),
  sceneInput = scenePath === null ? null : await read(scenePath);
if (worker) {
  assert.equal(worker.scope.actualDecodedReplayRequests, true);
  assert.equal(worker.scope.suppliedPerRequestPlacement, false);
  assert.equal(worker.controls.identical1x4xCheckpoint, true);
  assert.ok(Array.isArray(worker.navGroundPrograms));
  for (const selected of worker.navGroundPrograms) {
    const emitter = prepared.definitions
      .get(selected.definitionId)
      ?.emitters.find((e) => e.index === selected.emitterId);
    assert.ok(emitter?.navGroundProgram);
    assert.equal(selected.materialKey, emitter.materialKey);
    assert.deepEqual(selected.navGroundProgram, emitter.navGroundProgram);
  }
  for (const [path, digest] of Object.entries(worker.inputs))
    assert.equal(await sha256(await raw(path)), digest, path);
}
const nativeSamplerBytes = await raw(
  `${cache}/research/navmesh-scene-sampler-native.json`,
);
assert.equal(
  await sha256(nativeSamplerBytes),
  api.DIRECT_NAV_SCENE_SAMPLER.nativeProofSha256,
);
const uploads = [],
  passes = [],
  readinessMaterials = [],
  materialInitializations = [],
  resourceId = (texture) => {
    assert.ok(
      texture?.isTexture && texture.name.startsWith("OriginalNavmask_"),
    );
    return texture.name.slice("OriginalNavmask_".length);
  };
let target = null,
  viewport = new THREE.Vector4(0, 0, 512, 512),
  scissor = viewport.clone(),
  scissorTest = false;
const gl = {
    SCISSOR_BOX: 0x0c10,
    SCISSOR_TEST: 0x0c11,
    NO_ERROR: 0,
    LINK_STATUS: 0x8b82,
    getError: () => 0,
    getParameter: () => scissor.toArray(),
    isEnabled: () => scissorTest,
    getProgramParameter: () => true,
  },
  host = {
    isWebGLRenderer: true,
    capabilities: { reversedDepthBuffer: false },
    xr: { enabled: false },
    autoClear: true,
    info: threeSubmission.info,
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getCurrentViewport: (v) => v.copy(viewport),
    getContext: () => gl,
    state: {
      buffers: { depth: { getReversed: () => false } },
      viewport: (v) => viewport.copy(v),
      scissor: (v) => scissor.copy(v),
      setScissorTest: (v) => {
        scissorTest = v;
      },
    },
    setRenderTarget: (v) => {
      target = v;
      if (v) {
        viewport.copy(v.viewport);
        scissor.copy(v.scissor);
        scissorTest = v.scissorTest;
      }
    },
    initTexture: (texture) => {
      assert.ok(texture?.isTexture && texture.image.data instanceof Uint8Array);
      const row = {
        width: texture.image.width,
        height: texture.image.height,
        bytesHex: texture.image.data.toHex(),
      };
      if (texture.name.startsWith("OriginalNavmask_"))
        uploads.push({ id: resourceId(texture), ...row });
      else materialInitializations.push(row);
    },
    initRenderTarget: (target) => {
      assert.ok(target?.isWebGLRenderTarget);
    },
    compileAsync: async (scene) => {
      readinessMaterials.push(
        ...scene.children.map((mesh) => mesh.material.name),
      );
    },
    properties: { get: () => ({ currentProgram: { program: {} } }) },
    render: (scene, camera) => {
      threeSubmission.render(scene, camera);
      assert.equal(host.info.render.calls, 1);
      assert.deepEqual(threeSubmission.draws.at(-1), {
        mode: 4,
        start: 0,
        count: 3,
      });
      assert.equal(scene.children.length, 1);
      const material = scene.children[0].material,
        shader =
          material.fragmentShader === program.fadeBody
            ? "fade"
            : material.fragmentShader === program.blurBody
              ? "blur"
              : null;
      assert.ok(shader);
      const names =
          shader === "fade"
            ? {
                current: "SAMPLER_NAV_GRID_CURRENT_TX",
                target: "SAMPLER_NAV_GRID_TARGET_TX",
              }
            : { source: "srcTex_TX" },
        textures = {},
        samplers = {};
      for (const [role, name] of Object.entries(names)) {
        const t = material.uniforms[name].value;
        textures[role] = resourceId(t);
        assert.equal(t.minFilter, t.magFilter);
        samplers[role] =
          t.minFilter === THREE.NearestFilter
            ? "clamp-nearest"
            : "clamp-linear";
      }
      passes.push({
        shader,
        target: resourceId(target.texture),
        parameters: Array.from(material.uniformsGroups[0].uniforms[0].value),
        textures,
        samplers,
      });
    },
  },
  provider = new api.LatestDirectNavSceneRenderer({
    renderer: host,
    worldNavScene,
    program,
  });
await provider.prepare();
const world = new THREE.Group(),
  ground = new api.LatestDirectNavGroundRenderer(world, {
    materials: prepared.navGroundMaterials,
    provider,
    worldNavScene,
    gpuRenderer: host,
  }),
  definitions = new Map(
    [...prepared.definitions].map(([id, d]) => [
      id,
      {
        ...d,
        emitters: d.emitters.filter((emitter) => emitter.navGroundProgram),
      },
    ]),
  );
await ground.loadDefinitions(definitions);
assert.equal(
  [...definitions.values()].flatMap((d) => d.emitters).length,
  materialPackage.emitters.length,
);
const anchor = [7000, 0, 7000],
  runtime = new api.LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "a".repeat(64),
    definitions,
    kernels: prepared.kernels,
    events: [...definitions.keys()].map((id, i) => ({
      id: `explicit-nav-ground-control:${i}`,
      kind: "create",
      origin: "network-effect",
      time: 0,
      transportSequence: i + 1,
      entryOrder: 0,
      entityId: i + 1,
      definitionId: id,
      seedHex: "0000000000003039",
    })),
    world: {
      placement: () => ({
        resolved: true,
        position: anchor,
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        boundObjectSize: 0,
      }),
    },
  }),
  camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 1, 30000);
camera.position.set(7000, 15000, 7000);
camera.up.set(0, 0, 1);
camera.lookAt(...anchor);
camera.updateMatrixWorld(true);
const drawCamera = {
    right: [1, 0, 0],
    up: [0, 0, 1],
    axis: [0, 1, 0],
    position: [7000, 15000, 7000],
  },
  frames = [],
  materials = {};
function cameraFor(input) {
  const result = new THREE.Camera();
  result.position.fromArray(input.position);
  result.updateMatrixWorld(true);
  const rows = [...input.projectionRows];
  for (let lane = 0; lane < 4; lane++)
    rows[8 + lane] = 2 * rows[8 + lane] - rows[12 + lane];
  result.projectionMatrix.set(...rows).multiply(result.matrixWorld);
  return result;
}
function restoreDraw(draw) {
  const restored = {
    ...draw,
    positions: Float32Array.from(draw.positions),
    colors: Float32Array.from(draw.colors),
    uv: Float32Array.from(draw.uv),
    particleUV: Uint16Array.from(draw.particleUV),
    indices: Uint16Array.from(draw.indices),
  };
  if (draw.multUV) restored.multUV = Uint16Array.from(draw.multUV);
  const actual = api.directGeometryBuffers(restored);
  assert.equal(actual.vertices.toHex(), draw.geometry.verticesHex);
  assert.equal(actual.indices.toHex(), draw.geometry.indicesHex);
  return restored;
}
const sourceFrames =
    worker?.snapshots ?? [0, 0.25, 0.5].map((time) => ({ time })),
  wantedKeys = new Set(
    materialPackage.emitters.map((e) => `${e.effectId}:${e.emitterIndex}`),
  );
for (const frame of sourceFrames) {
  const time = frame.time;
  if (!worker) runtime.advanceTo(time);
  const packet = worker
      ? {
          time,
          draws: frame.draws
            .filter((draw) => wantedKeys.has(draw.materialKey))
            .map(restoreDraw),
        }
      : runtime.generateDraws(drawCamera),
    before = passes.length,
    staged = sceneInput?.bySource
      ? { time, frame: provider.stage(time), pending: [], active: new Set() }
      : ground.preflight(packet, sceneInput ? cameraFor(sceneInput) : camera),
    binding = provider.renderAtSync(time);
  if (sceneInput?.bySource)
    for (const draw of packet.draws) {
      const part = ground.preflight(
        { time, draws: [draw] },
        cameraFor(sceneInput.bySource[draw.sourceEventId]),
      );
      staged.pending.push(...part.pending);
      for (const key of part.active) staged.active.add(key);
    }
  const draws = [];
  for (const p of staged.pending) {
    ground.commit(
      { ...staged, pending: [p], active: new Set([p.key]) },
      binding,
      true,
    );
    const mesh = ground.meshes.get(p.key),
      b = p.b,
      r = b.resource;
    assert.ok(mesh.visible && mesh.geometry.index.count > 0);
    for (const [name, attribute] of Object.entries({
      a_POSITION: p.attributes.a_POSITION,
      a_COLOR: p.attributes.a_COLOR,
      a_TEXCOORD: p.attributes.a_TEXCOORD,
      a_TEXCOORD1: p.attributes.a_TEXCOORD1,
    }))
      assert.deepEqual(mesh.geometry.attributes[name].array, attribute);
    assert.deepEqual(mesh.geometry.index.array, p.attributes.index);
    assert.equal(b.material.vertexShader, r.stages[0].glsl.slice(16));
    assert.equal(b.material.fragmentShader, r.stages[1].glsl.slice(16));
    assert.equal(
      b.uniforms[b.navName].value,
      provider.resources.targets.get("output").texture,
    );
    assert.equal(b.material.blending, THREE.CustomBlending);
    const factors = {
      1: THREE.OneFactor,
      770: THREE.SrcAlphaFactor,
      771: THREE.OneMinusSrcAlphaFactor,
    };
    assert.deepEqual(
      [
        b.material.blendSrc,
        b.material.blendDst,
        b.material.blendSrcAlpha,
        b.material.blendDstAlpha,
      ],
      r.material.pipeline.state.blendFactors.map((factor) => factors[factor]),
    );
    assert.equal(b.material.blendEquation, THREE.AddEquation);
    assert.equal(b.material.blendEquationAlpha, THREE.AddEquation);
    assert.equal(b.material.depthTest, false);
    assert.equal(b.material.depthWrite, false);
    assert.equal(b.material.side, THREE.DoubleSide);
    assert.equal(
      b.material.polygonOffset,
      r.material.pipeline.state.polygonOffsetEnabled,
    );
    if (b.material.polygonOffset)
      assert.deepEqual(
        [b.material.polygonOffsetFactor, b.material.polygonOffsetUnits],
        r.material.pipeline.state.polygonOffset,
      );
    const textureNames = new Map(
        r.stages.flatMap((s) =>
          s.sidecar.textures.flatMap((t) =>
            t.samplers.map((v) => [t.name, v.glslName]),
          ),
        ),
      ),
      textures = Object.fromEntries(
        [...textureNames].map(([name, glsl]) => {
          const t = b.uniforms[glsl].value;
          if (name === "NAVMESH_MASK_TEXTURE_SharedTexture")
            return [name, { providerResourceId: resourceId(t) }];
          assert.ok(t.image.data instanceof Uint8Array);
          assert.equal(t.minFilter, THREE.LinearFilter);
          assert.equal(t.magFilter, THREE.LinearFilter);
          assert.equal(t.generateMipmaps, false);
          assert.equal(t.flipY, false);
          assert.equal(t.colorSpace, THREE.NoColorSpace);
          const original = r.material.textures.find(
            (texture) => texture.name === name,
          );
          if (original) {
            const parameters = original.sampler.parameters;
            assert.equal(
              t.wrapS,
              parameters[10242] === 10497
                ? THREE.RepeatWrapping
                : THREE.ClampToEdgeWrapping,
            );
            assert.equal(
              t.wrapT,
              parameters[10243] === 10497
                ? THREE.RepeatWrapping
                : THREE.ClampToEdgeWrapping,
            );
          }
          return [
            name,
            {
              width: t.image.width,
              height: t.image.height,
              rgbaHex: t.image.data.toHex(),
              wrapS: t.wrapS,
              wrapT: t.wrapT,
              minFilter: t.minFilter,
              magFilter: t.magFilter,
            },
          ];
        }),
      );
    materials[p.draw.materialKey] ??= {
      stages: r.stages,
      material: r.material,
      textures,
      actualThreePipeline: {
        blending: b.material.blending,
        blendSrc: b.material.blendSrc,
        blendDst: b.material.blendDst,
        blendSrcAlpha: b.material.blendSrcAlpha,
        blendDstAlpha: b.material.blendDstAlpha,
        depthTest: b.material.depthTest,
        depthWrite: b.material.depthWrite,
        side: b.material.side,
        polygonOffset: b.material.polygonOffset,
        polygonOffsetFactor: b.material.polygonOffsetFactor,
        polygonOffsetUnits: b.material.polygonOffsetUnits,
      },
    };
    const geometry = api.directGeometryBuffers(p.draw);
    draws.push({
      ...mesh.userData.identity,
      materialKey: p.draw.materialKey,
      particleCount: p.draw.particleCount,
      verticesHex: geometry.vertices.toHex(),
      indicesHex: geometry.indices.toHex(),
      uniformBlocks: p.blocks.map((block, i) => {
        const bytes = new Uint8Array(b.blocks[i].data.buffer);
        assert.equal(bytes.toHex(), block.bytes.toHex());
        return {
          stage: block.stage,
          name: block.name,
          binding: block.binding,
          bytesHex: bytes.toHex(),
        };
      }),
    });
  }
  const nav = provider.materialInputs({
    requiredScene: (
      staged.pending[0]?.b ?? ground.bindings.values().next().value
    ).resource.material.requiredScene,
    binding,
    replayTime: time,
  }).inputs.textures.NAVMESH_MASK_TEXTURE_SharedTexture;
  frames.push({
    time,
    passes: passes.slice(before),
    draws,
    navigationSampler: {
      descriptorHex: nav.samplerDescriptorHex,
      parameters: nav.samplerParameters,
      identity: nav.samplerIdentity,
    },
  });
}
ground.dispose();
provider.dispose();
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = process.argv[5]
  ? resolve(process.argv[5])
  : `${cache}/research/direct-nav-ground-renderer-commands.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "owned-three-nav-ground-renderer-command-export",
      inputs,
      sourceNavigation: sourcePackage.navigation,
      uploads,
      frames,
      materials,
      readinessMaterials,
      materialInitializations,
      producerBufferSubmissions: threeSubmission.draws,
      scope: {
        actualSharedRetainedRuntime: true,
        exactCompiledAuthoredDefinitions: true,
        sameOwnedSceneProviderAndGroundRenderer: true,
        actualThreeResourceObjects: true,
        installedThreeRenderBufferDirectBufferRendererAndInfoExecuted: true,
        commandCaptureHostOnly: true,
        actualThreeWebGlBackendExecuted: false,
        hostReadinessSimulationOnly: true,
        explicitPlacementControl: worker === null,
        actualDecodedMatchPlacement: worker !== null,
        nativeWorldPixelParity: false,
        gpuReplayPending: true,
        renderedCoverageClaimed: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    frames: frames.length,
    draws: frames.reduce((n, f) => n + f.draws.length, 0),
    materials: Object.keys(materials).length,
    inputs: Object.keys(inputs).length,
  }),
);
