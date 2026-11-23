// Actual owned package/compiler + THREE material loader. No WebGL submission.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [cacheArg, vendorArg, publicArg, outputArg, nativeControlArg] =
  process.argv.slice(2);
if ((publicArg && !outputArg) || (outputArg && !publicArg))
  throw Error(
    "Explicit public and owned proof output roots must be supplied together",
  );
const cache = resolve(cacheArg ?? ".cache/replay-lineup-5667809143"),
  root = resolve(import.meta.dir, ".."),
  assets = publicArg ? resolve(publicArg) : resolve(cache, "public"),
  vendor = resolve(
    vendorArg ?? ".cache/replay-spike/public/vendor/three.module.js",
  ),
  proofDirectory = outputArg ? resolve(outputArg) : resolve(cache, "research"),
  inputs = {},
  requests = [];
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selected renderer input changed: " + path);
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs(
  [
    import.meta.path,
    resolve(root, "latest-direct-effect-renderer.mjs"),
    resolve(root, "latest-direct-effect-package.mjs"),
  ],
  raw,
);
await raw(vendor);
await raw(resolve(vendor, "../three.core.js"));
const entry = [
  "latest-direct-effect-renderer.mjs",
  "latest-direct-effect-package.mjs",
  "latest-static-catalog.mjs",
  "latest-selected-material-textures.mjs",
  "latest-direct-effect-runtime.mjs",
];
const bundle = await Bun.build({
  entrypoints: ["selected-renderer-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "selected-renderer-and-pinned-three",
      setup(build) {
        build.onResolve({ filter: /^selected-renderer-entry$/ }, () => ({
          path: "entry",
          namespace: "selected-renderer",
        }));
        build.onLoad({ filter: /.*/, namespace: "selected-renderer" }, () => ({
          loader: "js",
          contents: entry
            .map(
              (file) =>
                `export * from ${JSON.stringify(resolve(root, file).replaceAll("\\", "/"))};`,
            )
            .join("\n"),
        }));
        build.onResolve({ filter: /^three$/ }, () => ({ path: vendor }));
      },
    },
  ],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw new AggregateError(bundle.logs, "Selected renderer bundle failed");
await mkdir(proofDirectory, { recursive: true });
const bundlePath = resolve(
  proofDirectory,
  "selected-material-renderer.bundle.mjs",
);
if (outputArg && (await Bun.file(bundlePath).exists()))
  throw Error("Fresh owned renderer proof output required");
await Bun.write(bundlePath, bundle.outputs[0]);
await raw(bundlePath);
const api = await import(pathToFileURL(bundlePath).href),
  THREE = await import(pathToFileURL(vendor).href),
  load = async (path) => {
    requests.push(path);
    return raw(resolve(assets, path));
  },
  selection = await api.loadLatestStaticCatalogSelection({ load }),
  manifestBytes = await selection.readRole("effects"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  quad = JSON.parse(
    new TextDecoder().decode(await selection.readRole("quadGpu")),
  ),
  effectIds = publicArg
    ? [...new Set(quad.emitters.map((e) => e.effectId))]
    : [...new Set(quad.emitters.map((e) => e.effectId))].slice(0, 10),
  prepared = await api.loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds,
    staticCatalog: selection,
  }),
  renderer = new api.LatestDirectEffectRenderer(
    new THREE.Group(),
    manifest,
    manifestBytes,
    { staticCatalog: selection, selectedMaterials: prepared.selectedMaterials },
  );
assert.equal(prepared.selectedMaterials.mode, "native-quad-partial");
const invalidWorld = new THREE.Group();
assert.throws(
  () =>
    new api.LatestDirectEffectRenderer(invalidWorld, manifest, manifestBytes, {
      staticCatalog: selection,
      selectedMaterials: { mode: "native-quad-partial" },
    }),
  /Owned selected material registry/,
);
assert.equal(
  invalidWorld.children.length,
  0,
  "Rejected material ownership must not mutate the world",
);
const independentlyOwnedSelection = await api.loadLatestStaticCatalogSelection({
  load,
});
assert.throws(
  () =>
    new api.LatestDirectEffectRenderer(invalidWorld, manifest, manifestBytes, {
      staticCatalog: independentlyOwnedSelection,
      selectedMaterials: prepared.selectedMaterials,
    }),
  {
    message: Object.hasOwn(selection.describe(), "sourceAuthorities")
      ? "Scene material registry belongs to a different selected catalog"
      : "Selected material registry belongs to a different owned catalog",
  },
);
assert.equal(invalidWorld.children.length, 0);
const rendererRequestsStart = requests.length;
let summary;
try {
  await renderer.loadDefinitions(prepared.definitions);
  const expected = [...prepared.definitions.values()]
    .flatMap((d) => d.emitters.map((e) => e.materialKey))
    .sort();
  assert(
    expected.length > 0,
    "Bounded selected definitions must admit real components",
  );
  assert.deepEqual([...renderer.gpuMaterials.keys()].sort(), expected);
  assert.equal(renderer.staticMeshRenderer, null);
  assert.equal(renderer.rayRenderer, null);
  assert.equal(renderer.navGroundRenderer, null);
  for (const { prepared: p, material } of renderer.gpuMaterials.values()) {
    assert.equal(material.isRawShaderMaterial, true);
    for (const [name, binding] of Object.entries(p.textures)) {
      const texture = material.uniforms[name].value;
      assert.equal(texture.isDataTexture, true);
      assert.equal(texture.flipY, false);
      assert.equal(texture.generateMipmaps, false);
      assert.equal(texture.colorSpace, THREE.NoColorSpace);
      if (binding.kind === "prepared-texture") {
        const exact = await renderer.selectedTextureOwner.readTexture(binding);
        assert.deepEqual(texture.image.data, exact.data);
        assert.equal(texture.image.width, exact.width);
        assert.equal(texture.image.height, exact.height);
      }
    }
  }
  const png = prepared.selectedMaterials.materialTextureReferences()[0];
  assert(png, "Bounded source controls must exercise actual PNGs");
  await assert.rejects(
    () =>
      renderer.selectedTextureOwner.readTexture({
        kind: "prepared-texture",
        file: "textures/foreign.png",
        sha256: png.pngSha256,
      }),
    /not referenced/,
  );
  await assert.rejects(
    () =>
      renderer.selectedTextureOwner.readTexture({
        kind: "prepared-texture",
        file: png.file,
        sha256: "0".repeat(64),
      }),
    /not referenced/,
  );
  const forbidden =
    /^latest-(?:parent-textures|effect-root-textures|component-textures|trail-particles|quad-erosion-gpu|direct-ground-materials|direct-static-mesh|direct-ray)/;
  assert.equal(
    requests.slice(rendererRequestsStart).some((path) => forbidden.test(path)),
    false,
    "Selected partial renderer must not fetch legacy/unprepared material families",
  );
  let sourceFrameControl = null;
  if (nativeControlArg) {
    const nativeBytes = await raw(nativeControlArg),
      native = JSON.parse(new TextDecoder().decode(nativeBytes));
    assert.equal(
      native.kind,
      "original-archived-arbitrary-particle-orientation",
    );
    assert.equal(native.effectsManifestSha256, await sha256(manifestBytes));
    const image = await selection.read("decoder-16.21-macos/image.bin");
    assert.equal(native.decoderImageSha256, await sha256(image));
    for (const [file, hash] of Object.entries(native.inputs))
      assert.equal(await sha256(await raw(file)), hash, file);
    for (const block of native.originalBlocks)
      assert.equal(
        await sha256(image.subarray(block.rva, block.rva + block.size)),
        block.sha256,
      );
    const camera = new THREE.OrthographicCamera(
      -1000,
      1000,
      1000,
      -1000,
      0.1,
      5000,
    );
    camera.position.set(0, 1000, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    let frames = 0,
      nonemptyFrames = 0,
      positionLanes = 0;
    for (const c of native.cases.filter((row) => row.variant === "authored")) {
      const definition = prepared.definitions.get(c.effectId);
      assert.deepEqual(definition.blockers, []);
      assert(definition.emitters.some((row) => row.index === c.emitterIndex));
      const atTime = (time) =>
        c.frames[
          Math.min(c.frames.length - 1, Math.max(0, Math.round(time * 60)))
        ].input;
      const runtime = new api.LatestDirectEffectRuntime({
        ...prepared.contract,
        contentHash: definition.contentHash,
        replayHash: "9".repeat(64),
        definitions: prepared.definitions,
        kernels: prepared.kernels,
        events: [
          {
            id: `native-frame:${c.seedHex}:${c.schedule}`,
            kind: "create",
            origin: "animation",
            entityId: 1,
            definitionId: definition.id,
            time: 0,
            transportSequence: 0,
            entryOrder: 0,
            seedHex: c.seedHex,
          },
        ],
        world: {
          placement: (_event, time) => {
            const input = atTime(time);
            return {
              resolved: true,
              position: input.current,
              basis: input.basis.filter(
                (_, index) => index < 12 && index % 4 !== 3,
              ),
            };
          },
        },
      });
      for (const frame of c.frames) {
        runtime.advanceTo(frame.input.time);
        const packet = runtime.generateDraws({
          right: frame.input.cameraRight,
          up: frame.input.cameraUp,
          position: frame.input.viewPosition,
        });
        renderer.commitDirect(packet, camera);
        const meshes = [...renderer.directMeshes.values()].filter(
            (mesh) => mesh.visible,
          ),
          expected = Uint8Array.fromHex(frame.output.geometry.verticesHex),
          view = new DataView(expected.buffer);
        assert.equal(meshes.length, expected.length ? 1 : 0);
        if (expected.length) {
          const mesh = meshes[0],
            positions = mesh.geometry.attributes.a_POSITION.array;
          assert.equal(mesh.material.isRawShaderMaterial, true);
          assert.equal(positions.length / 3, expected.length / 28);
          for (let vertex = 0; vertex < expected.length / 28; vertex++)
            for (let lane = 0; lane < 3; lane++) {
              assert.equal(
                positions[vertex * 3 + lane],
                view.getFloat32(vertex * 28 + lane * 4, true),
              );
              positionLanes++;
            }
          const index = Uint8Array.fromHex(frame.output.geometry.indicesHex);
          assert.deepEqual(
            new Uint8Array(mesh.geometry.index.array.buffer),
            index,
          );
          nonemptyFrames++;
        }
        frames++;
      }
    }
    assert(nonemptyFrames > 0);
    sourceFrameControl = {
      nativeControlSha256: await sha256(nativeBytes),
      frames,
      nonemptyFrames,
      exactPositionLanes: positionLanes,
      actualDirectRuntimeToRenderer: true,
      suppliedWorldBasis: true,
      replayActivationEstablished: false,
    };
  }
  summary = {
    effectIds,
    materials: expected.length,
    textures: renderer.textures.size,
    rgba: renderer.selectedTextureOwner.describe(),
    rendererRequests: requests.slice(rendererRequestsStart),
    ...(sourceFrameControl ? { sourceFrameControl } : {}),
  };
} finally {
  renderer.dispose();
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Selected renderer proof input changed: " + path);
const report = {
  schema: 1,
  kind: "owned-selected-quad-material-renderer-loader-control",
  inputs,
  summary,
  scope: {
    actualSharedCompiler: true,
    actualOwnedCatalog: true,
    actualNativeMaterialRegistry: true,
    actualThreeMaterialAndTextureObjects: true,
    pngRawChannelBytesCompared: true,
    webGlSubmitted: false,
    browserExecuted: false,
    actualMatchCoverageEstablished: false,
    unpreparedFamiliesLoaded: false,
  },
};
await Bun.write(
  resolve(proofDirectory, "selected-material-renderer-control.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(summary));
