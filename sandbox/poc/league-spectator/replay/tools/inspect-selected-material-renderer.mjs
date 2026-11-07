// Actual owned package/compiler + THREE material loader. No WebGL submission.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  root = resolve(import.meta.dir, ".."),
  assets = resolve(cache, "public"),
  vendor = resolve(".cache/replay-spike/public/vendor/three.module.js"),
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
const bundlePath = `${cache}/research/selected-material-renderer.bundle.mjs`;
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
  effectIds = [...new Set(quad.emitters.map((e) => e.effectId))].slice(0, 10),
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
  /different owned catalog/,
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
  summary = {
    effectIds,
    materials: expected.length,
    textures: renderer.textures.size,
    rgba: renderer.selectedTextureOwner.describe(),
    rendererRequests: requests.slice(rendererRequestsStart),
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
  `${cache}/research/selected-material-renderer-control.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(summary));
