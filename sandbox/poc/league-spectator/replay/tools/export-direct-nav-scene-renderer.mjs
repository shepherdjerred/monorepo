// Exercise the actual THREE resource/executor module using a command-capture
// host. GLES replays these emitted resources/commands in a separate tool. This
// is not execution of THREE's WebGL backend or browser acceptance.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { DIRECT_NAV_SCENE_POLICY } from "../latest-direct-nav-scene-contract.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Nav renderer input drift: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await raw(`${cache}/public/vendor/three.module.js`);
await raw(`${cache}/public/vendor/three.core.js`);
const build = await Bun.build({
  entrypoints: ["nav-renderer-control"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "exact-installed-three-nav-command-capture",
      setup(build) {
        build.onResolve({ filter: /^nav-renderer-control$/ }, () => ({
          path: "entry",
          namespace: "nav-renderer-control",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "nav-renderer-control" },
          () => ({
            loader: "js",
            contents: [
              "latest-direct-nav-scene-renderer.mjs",
              "latest-direct-nav-scene.mjs",
              "latest-direct-nav-scene-gpu.mjs",
            ]
              .map(
                (name) =>
                  `export * from ${JSON.stringify(resolve(import.meta.dir, "..", name).replaceAll("\\", "/"))};`,
              )
              .join("\n"),
          }),
        );
        build.onResolve({ filter: /^three$/ }, () => ({
          path: resolve(cache, "public/vendor/three.module.js"),
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Nav renderer capture bundle failed");
const bundle = `${cache}/research/direct-nav-scene-renderer.bundle.mjs`;
await Bun.write(bundle, build.outputs[0]);
await raw(bundle);
const THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  {
    LatestDirectNavSceneRenderer,
    createLatestDirectNavScene,
    loadDirectNavSceneGpuProgram,
    DIRECT_NAV_SCENE_SAMPLER,
  } = await import(pathToFileURL(bundle).href);
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(import.meta.dir, "../latest-direct-nav-scene-renderer.mjs"),
  ],
  raw,
);
const sceneManifestBytes = await raw(
    `${cache}/public/latest-scene/manifest.json`,
  ),
  sourcePackageBytes = await raw(
    `${cache}/public/latest-direct-nav-scene/package.json`,
  ),
  program = await loadDirectNavSceneGpuProgram({
    load: (path) => raw(`${cache}/public/${path}`),
  }),
  proof = await read(`${cache}/research/navmesh-producer-comparison.json`),
  sampler = await read(`${cache}/research/navmesh-scene-sampler-native.json`),
  native = await read(
    `${cache}/research/navmesh-producer-v29/native-high.json`,
  ),
  nativeMaterials = await read(
    `${cache}/public/latest-parent-native-materials/package.json`,
  );
assert.equal(
  await sha256(
    await raw(`${cache}/research/navmesh-scene-sampler-native.json`),
  ),
  DIRECT_NAV_SCENE_SAMPLER.nativeProofSha256,
);
for (const p of [proof, sampler])
  for (const [path, digest] of Object.entries(p.inputs))
    assert.equal(await sha256(await raw(path)), digest, path);
for (const control of sampler.controls) {
  assert.equal(control.descriptorHex, DIRECT_NAV_SCENE_SAMPLER.descriptorHex);
  assert.deepEqual(
    control.gpuSampler.queriedParameters,
    DIRECT_NAV_SCENE_SAMPLER.parameters,
  );
}
assert.equal(native.boundary, null);
assert.equal(native.result.renderPasses.length, 15);
const reflected = Object.values(nativeMaterials.roots)
  .flatMap((root) => Object.values(root.actors))
  .flatMap((actor) => actor.rows)
  .flatMap((row) => row.variants)
  .find((v) =>
    v.requiredScene.textures.some(
      (t) => t.name === "NAVMESH_MASK_TEXTURE_SharedTexture",
    ),
  ).requiredScene;
const cases = [];
let draws = 0,
  pausedRedrawControls = 0,
  stateRestoreControls = 0;
for (const dpr of [1, 2]) {
  const worldNavScene = await createLatestDirectNavScene({
      sceneManifestBytes,
      sourcePackageBytes,
      policy: DIRECT_NAV_SCENE_POLICY,
    }),
    uploads = [],
    recorded = [],
    screenTarget = null,
    hostViewport = new THREE.Vector4(13, 17, 1920 * dpr, 1080 * dpr),
    hostScissor = new THREE.Vector4(23, 29, 1000 * dpr, 900 * dpr);
  let currentTarget = screenTarget,
    currentViewport = hostViewport.clone(),
    currentScissor = hostScissor.clone(),
    scissorTest = true;
  const resourceId = (texture) => {
    assert(texture?.isTexture === true);
    assert(texture.name.startsWith("OriginalNavmask_"));
    return texture.name.slice("OriginalNavmask_".length);
  };
  const host = {
    isWebGLRenderer: true,
    xr: { enabled: true },
    autoClear: true,
    info: { autoReset: true, render: { calls: 0 } },
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getCurrentViewport: (value) => value.copy(currentViewport),
    getContext: () => ({
      SCISSOR_BOX: 0x0c10,
      SCISSOR_TEST: 0x0c11,
      NO_ERROR: 0,
      getError: () => 0,
      getParameter: (name) => {
        assert.equal(name, 0x0c10);
        return hostScissor.toArray();
      },
      isEnabled: (name) => {
        assert.equal(name, 0x0c11);
        return scissorTest;
      },
    }),
    state: {
      viewport: (value) => currentViewport.copy(value),
      scissor: (value) => currentScissor.copy(value),
      setScissorTest: (value) => (scissorTest = value),
    },
    setRenderTarget: (target) => {
      currentTarget = target;
      if (target) {
        currentViewport.copy(target.viewport);
        currentScissor.copy(target.scissor);
        scissorTest = target.scissorTest;
      }
    },
    initTexture: (texture) => {
      assert.equal(texture.format, THREE.RedFormat);
      assert.equal(texture.internalFormat, "R8");
      assert.equal(texture.type, THREE.UnsignedByteType);
      assert.equal(texture.flipY, false);
      assert.equal(texture.generateMipmaps, false);
      assert.equal(texture.colorSpace, THREE.NoColorSpace);
      assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
      assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
      uploads.push({
        id: resourceId(texture),
        bytes: texture.image.data.slice(),
        width: texture.image.width,
        height: texture.image.height,
      });
    },
    render: (scene, camera) => {
      host.info.render.calls = 1;
      assert.equal(scene.children.length, 1);
      assert.equal(camera.isCamera, true);
      const mesh = scene.children[0],
        material = mesh.material;
      assert.equal(mesh.frustumCulled, false);
      assert.equal(material.isRawShaderMaterial, true);
      assert.equal(material.vertexShader, program.vertexBody);
      assert.equal(material.blending, THREE.NoBlending);
      assert.equal(material.depthTest, false);
      assert.equal(material.depthWrite, false);
      assert.equal(material.side, THREE.DoubleSide);
      assert.equal(material.toneMapped, false);
      assert.equal(material.transparent, false);
      assert.deepEqual(
        Array.from(mesh.geometry.attributes.a_POSITION.array),
        [0, 0, 2, 0, 0, 2],
      );
      assert.equal(mesh.geometry.attributes.a_POSITION.itemSize, 2);
      assert.equal(mesh.geometry.index, null);
      assert(currentTarget?.isWebGLRenderTarget);
      assert.deepEqual(currentViewport.toArray(), [0, 0, 992, 948]);
      assert.equal(scissorTest, false);
      assert.equal(host.xr.enabled, false);
      assert.equal(host.autoClear, false);
      assert.equal(currentTarget.depthBuffer, false);
      assert.equal(currentTarget.stencilBuffer, false);
      assert.equal(currentTarget.samples, 0);
      assert.equal(currentTarget.texture.internalFormat, "RGBA8");
      assert.equal(currentTarget.texture.colorSpace, THREE.NoColorSpace);
      const shader =
        material.fragmentShader === program.fadeBody
          ? "fade"
          : material.fragmentShader === program.blurBody
            ? "blur"
            : null;
      assert(shader);
      const parameters = Array.from(
          material.uniformsGroups[0].uniforms[0].value,
        ),
        textures = {},
        samplers = {};
      const names =
        shader === "fade"
          ? {
              current: "SAMPLER_NAV_GRID_CURRENT_TX",
              target: "SAMPLER_NAV_GRID_TARGET_TX",
            }
          : { source: "srcTex_TX" };
      for (const [role, name] of Object.entries(names)) {
        const texture = material.uniforms[name].value;
        textures[role] = resourceId(texture);
        const nearest = texture.minFilter === THREE.NearestFilter;
        assert.equal(
          texture.magFilter,
          nearest ? THREE.NearestFilter : THREE.LinearFilter,
        );
        assert.equal(
          texture.minFilter,
          nearest ? THREE.NearestFilter : THREE.LinearFilter,
        );
        samplers[role] = nearest ? "clamp-nearest" : "clamp-linear";
      }
      recorded.push({
        shader,
        target: resourceId(currentTarget.texture),
        parameters,
        textures,
        samplers,
      });
      draws++;
    },
  };
  const renderer = new LatestDirectNavSceneRenderer({
      renderer: host,
      worldNavScene,
      program,
    }),
    updates = [];
  for (const [index, time] of [0, 0.25, 0.5, 0, 0.5].entries()) {
    const before = recorded.length,
      binding = await renderer.renderAt(time);
    assert.equal(recorded.length - before, 5);
    const result = renderer.materialInputs({
      requiredScene: reflected,
      binding,
      replayTime: time,
    });
    assert.equal(result.reasons.length, 0);
    assert.equal(
      result.inputs.uniforms.NAV_GRID_XFORM.toHex(),
      JSON.parse(new TextDecoder().decode(sourcePackageBytes)).navigation
        .transformHex,
    );
    const texture = result.inputs.textures.NAVMESH_MASK_TEXTURE_SharedTexture;
    assert.equal(
      texture.texture,
      renderer.resources.targets.get("output").texture,
    );
    assert.equal(texture.samplerIdentity, DIRECT_NAV_SCENE_SAMPLER.name);
    assert.equal(
      texture.samplerDescriptorHex,
      DIRECT_NAV_SCENE_SAMPLER.descriptorHex,
    );
    assert.deepEqual(currentViewport.toArray(), hostViewport.toArray());
    assert.deepEqual(currentScissor.toArray(), hostScissor.toArray());
    assert.equal(currentTarget, screenTarget);
    assert.equal(host.autoClear, true);
    assert.equal(host.xr.enabled, true);
    assert.equal(scissorTest, true);
    stateRestoreControls++;
    assert.equal(await renderer.renderAt(time), binding);
    assert.equal(recorded.length - before, 5);
    pausedRedrawControls++;
    const originalIndex = index < 3 ? index : index === 3 ? 0 : 2;
    updates.push({
      replayTime: time,
      targetLifetime: "per-update-pool-lease",
      upload:
        index === 0
          ? { target: uploads[2].id, bytesHex: uploads[2].bytes.toHex() }
          : null,
      passes: recorded.slice(before),
      expectedPixels: native.result.renderPasses
        .slice(originalIndex * 5, originalIndex * 5 + 5)
        .map((pass) => ({
          redSha256: null,
          redHex: pass.draws[0].redHex,
          rgbaSha256: pass.draws[0].rgbaSha256,
        })),
    });
  }
  assert.equal(uploads.length, 3);
  assert.deepEqual(
    uploads.map((u) => u.id),
    ["mask-a", "mask-b", "mask-a"],
  );
  assert(
    uploads[0].bytes.every((v) => v === 0) &&
      uploads[1].bytes.every((v) => v === 0),
  );
  for (const update of updates)
    for (const row of update.expectedPixels) {
      row.redSha256 = await sha256(Uint8Array.fromHex(row.redHex));
      delete row.redHex;
    }
  cases.push({
    resolution: `high-dpr${dpr}`,
    resources: {
      width: 992,
      height: 948,
      masks: uploads.slice(0, 2).map((u) => ({
        id: u.id,
        format: "r8-unorm",
        initialBytesHex: u.bytes.toHex(),
      })),
      targets: ["output", "scratch"].map((id) => ({
        id,
        format: "bgra8-unorm",
        initialBytes: null,
        lifetime: "per-update-pool-lease",
      })),
    },
    updates,
  });
  renderer.dispose();
  assert.throws(() => renderer.renderAt(0), /disposed/);
}
for (const [path, digest] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), digest, path);
const output = `${cache}/research/direct-nav-scene-renderer-commands.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "owned-three-nav-scene-executor-command-export",
      inputs,
      cases,
      mismatches: [],
      counts: { draws, pausedRedrawControls, stateRestoreControls },
      scope: {
        actualThreeResourceAndMaterialObjects: true,
        actualThreeWebGlBackendExecuted: false,
        commandCaptureHostOnly: true,
        guestInstructionsExecuted: false,
        gpuReplayPending: true,
        originalScenePublicationRecovered: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    draws,
    pausedRedrawControls,
    stateRestoreControls,
    fingerprints: Object.keys(inputs).length,
  }),
);
