// Component resource proof only. The independently gated effect simulator can
// still omit every emitter; this control does not assert simulation admission.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [publicArg, vendorArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun inspect-scene-cold-renderer-resources.mjs <closed-public-root> <pinned-three-module> <fresh-proof-directory>",
  );
const root = path.resolve(publicArg),
  vendor = path.resolve(vendorArg),
  out = path.resolve(outputArg),
  source = path.resolve(import.meta.dir, ".."),
  inputs = {},
  requests = [];
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs(
  [
    import.meta.path,
    path.join(source, "latest-parent-renderer.mjs"),
    path.join(source, "latest-selected-materials.mjs"),
    path.join(source, "latest-static-catalog.mjs"),
  ],
  raw,
);
await raw(vendor);
await raw(path.resolve(vendor, "../three.core.js"));
const files = [
  "latest-parent-renderer.mjs",
  "latest-selected-materials.mjs",
  "latest-static-catalog.mjs",
];
const bundle = await Bun.build({
  entrypoints: ["cold-resource-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "owned-cold-resource-control",
      setup(build) {
        build.onResolve({ filter: /^cold-resource-entry$/ }, () => ({
          path: "entry",
          namespace: "cold-resource",
        }));
        build.onLoad({ filter: /.*/, namespace: "cold-resource" }, () => ({
          loader: "js",
          contents: files
            .map(
              (file) =>
                `export * from ${JSON.stringify(path.join(source, file).replaceAll("\\", "/"))};`,
            )
            .join("\n"),
        }));
        build.onResolve({ filter: /^three$/ }, () => ({ path: vendor }));
      },
    },
  ],
});
if (!bundle.success || bundle.outputs.length !== 1)
  throw new AggregateError(bundle.logs, "Owned cold renderer bundle failed");
await mkdir(out, { recursive: true });
const bundleFile = path.join(out, "bundle.mjs");
if (await Bun.file(bundleFile).exists())
  throw Error("Fresh owned cold renderer proof output required");
await Bun.write(bundleFile, bundle.outputs[0]);
await raw(bundleFile);
const api = await import(pathToFileURL(bundleFile).href),
  THREE = await import(pathToFileURL(vendor).href),
  load = (file) => {
    requests.push(file);
    return raw(path.join(root, file));
  },
  selection = await api.loadLatestStaticCatalogSelection({ load }),
  manifestBytes = await selection.readRole("effects"),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  quad = JSON.parse(
    new TextDecoder().decode(await selection.readRole("quadGpu")),
  ),
  registry = await api.loadLatestSelectedMaterialRegistry({
    staticCatalog: selection,
    load,
    perspective: "all",
  }),
  ids = [...new Set(quad.emitters.map((row) => row.effectId))],
  renderer = new api.LatestParentVfxRenderer(
    new THREE.Group(),
    manifest,
    manifestBytes,
    {
      staticCatalog: selection,
      selectedMaterials: registry,
      perspective: "all",
    },
  );
let summary;
try {
  await renderer.load(ids);
  const expected = quad.emitters
    .map((row) => `${row.effectId}:${row.emitterIndex}`)
    .sort();
  assert(
    expected.length > 0,
    "Cold material component proof needs real source-prepared bindings",
  );
  assert.deepEqual([...renderer.gpuMaterials.keys()].sort(), expected);
  let cold = 0,
    fog = 0,
    png = 0,
    firstCold = null;
  for (const { prepared, material } of renderer.gpuMaterials.values()) {
    assert.equal(material.isRawShaderMaterial, true);
    for (const [uniform, binding] of Object.entries(prepared.textures)) {
      const texture = material.uniforms[uniform].value;
      assert.equal(texture.isDataTexture, true);
      assert.equal(texture.flipY, false);
      assert.equal(texture.generateMipmaps, false);
      assert.equal(texture.colorSpace, THREE.NoColorSpace);
      const ref =
        binding.kind === "original-cold-default-texture"
          ? registry.readColdDefaultTexture(binding)
          : binding.kind === "original-all-vision-fog-texture"
            ? registry.readAllVisionFogTexture(binding, "all")
            : await renderer.selectedTextureOwner.readTexture(binding);
      assert.deepEqual(texture.image.data, ref.data);
      assert.equal(texture.image.width, ref.width);
      assert.equal(texture.image.height, ref.height);
      assert.equal(
        texture.minFilter,
        binding.sampler.pixelated ? THREE.NearestFilter : THREE.LinearFilter,
      );
      assert.equal(texture.magFilter, texture.minFilter);
      if (
        [
          "original-cold-default-texture",
          "original-all-vision-fog-texture",
        ].includes(binding.kind)
      ) {
        if (binding.kind === "original-all-vision-fog-texture") fog++;
        else cold++;
        firstCold ??= binding;
      } else png++;
    }
  }
  assert(
    cold > 0 && png > 0,
    "Cold component proof must exercise both native default and original PNG resources",
  );
  const changed = { ...firstCold, rgba: [...firstCold.rgba] };
  changed.rgba[0] ^= 1;
  await assert.rejects(
    () => renderer.gpuTexture(changed),
    /not referenced by (?:a bound native material|an owned all-vision material)/,
  );
  await assert.rejects(
    () =>
      renderer.gpuTexture({ ...firstCold, authoritySha256: "0".repeat(64) }),
    /not referenced by (?:a bound native material|an owned all-vision material)/,
  );
  const world = new THREE.Group(),
    foreign = await api.loadLatestStaticCatalogSelection({ load });
  assert.throws(
    () =>
      new api.LatestParentVfxRenderer(world, manifest, manifestBytes, {
        staticCatalog: foreign,
        selectedMaterials: registry,
      }),
    /different selected catalog/,
  );
  assert.equal(world.children.length, 0);
  if (registry.describe().perspective === "all") {
    for (const perspective of [undefined, "blue", "red"]) {
      assert.throws(
        () =>
          new api.LatestParentVfxRenderer(
            new THREE.Group(),
            manifest,
            manifestBytes,
            {
              staticCatalog: selection,
              selectedMaterials: registry,
              perspective,
            },
          ),
        /another perspective/,
      );
      await assert.rejects(
        () =>
          api.loadLatestSelectedMaterialRegistry({
            staticCatalog: selection,
            load,
            perspective,
          }),
        /all-vision/,
      );
    }
  }
  assert.equal(
    requests.some((file) =>
      /^latest-(?:parent-textures|effect-root-textures|component-textures|trail-particles|quad-erosion-gpu)/.test(
        file,
      ),
    ),
    false,
    "No old or unprepared texture family may supply the new scene",
  );
  summary = {
    materials: expected.length,
    coldTextureUses: cold,
    allVisionFogTextureUses: fog,
    pngTextureUses: png,
    textureObjects: renderer.textures.size,
    rgba: renderer.selectedTextureOwner.describe(),
    negativeControls: registry.describe().perspective === "all" ? 9 : 3,
  };
} finally {
  renderer.dispose();
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Cold component renderer proof source changed");
await Bun.write(
  path.join(out, "control.json"),
  JSON.stringify({
    schema: 1,
    kind: "owned-cold-material-renderer-resource-control",
    summary,
    inputs,
    scope: {
      actualOwnedCatalog: true,
      actualNativeMaterialRegistry: true,
      actualThreeMaterialAndTextureObjects: true,
      sourcePngAndNativePixelBytesCompared: true,
      effectSimulationAdmissionEstablished: false,
      webGlSubmitted: false,
      browserExecuted: false,
      actualMatchCoverageEstablished: false,
      nativeRendererAdmitted: false,
    },
  }),
);
console.log(
  JSON.stringify({
    output: out,
    ...summary,
    inputHashes: Object.keys(inputs).length,
    nativeRendererAdmitted: false,
  }),
);
