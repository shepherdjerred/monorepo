// Actual owned renderer loader objects compared with native active reflection.
// Navigation texture publication and THREE's GL upload remain separate proofs.
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = resolve(cache, "public"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Sampler binding input changed: " + path);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const entries = [
  "latest-direct-effect-renderer.mjs",
  "latest-direct-effect-package.mjs",
  "latest-direct-nav-scene.mjs",
  "latest-direct-nav-scene-renderer.mjs",
  "latest-direct-nav-scene-gpu.mjs",
];
await captureDirectSourceInputs(
  [import.meta.path, ...entries.map((path) => resolve(root, path))],
  raw,
);
for (const file of ["three.module.js", "three.core.js"])
  await raw(`${assets}/vendor/${file}`);
const result = await Bun.build({
  entrypoints: ["sampler-binding-entry"],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "owned-sampler-binding-bundle",
      setup(build) {
        build.onResolve({ filter: /^sampler-binding-entry$/ }, () => ({
          path: "entry",
          namespace: "sampler-bindings",
        }));
        build.onLoad({ filter: /.*/, namespace: "sampler-bindings" }, () => ({
          loader: "js",
          contents: entries
            .map(
              (name) =>
                `export * from ${JSON.stringify(resolve(root, name).replaceAll("\\", "/"))};`,
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
if (!result.success)
  throw new AggregateError(result.logs, "Sampler binding source bundle failed");
const bundle = `${cache}/research/direct-sampler-bindings.bundle.mjs`;
await Bun.write(bundle, result.outputs[0]);
await raw(bundle);
const {
  LatestDirectEffectRenderer,
  loadLatestDirectEffectPackage,
  createLatestDirectNavScene,
  LatestDirectNavSceneRenderer,
  loadDirectNavSceneGpuProgram,
} = await import(pathToFileURL(bundle).href);
const THREE = await import(
  pathToFileURL(`${assets}/vendor/three.core.js`).href
);
const reflection = await read(
  `${cache}/research/direct-sampler-reflection-gles-v33.json`,
);
for (const [path, hash] of Object.entries(reflection.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Native sampler reflection source changed: " + path);
const effects = [
  ...new Set(
    reflection.materials
      .filter((m) => m.kind !== "nav-producer")
      .map((m) => m.materialKey.slice(0, m.materialKey.lastIndexOf(":"))),
  ),
];
const manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const prepared = await loadLatestDirectEffectPackage({
  load: (path) => raw(`${assets}/${path}`),
  manifestBytes,
  effectIds: effects,
});
const worldNavScene = await createLatestDirectNavScene({
  sceneManifestBytes: await raw(`${assets}/latest-scene/manifest.json`),
  sourcePackageBytes: await raw(
    `${assets}/latest-direct-nav-scene/package.json`,
  ),
  policy: "selected-installed-scene-initial-navigation-replay-zero-v1",
});
const renderer = new LatestDirectEffectRenderer(
  new THREE.Group(),
  manifest,
  manifestBytes,
  {
    navigation: {
      materials: prepared.navGroundMaterials,
      worldNavScene,
      loaderOnly: true,
      provider: null,
      gpuRenderer: null,
    },
  },
);
renderer.checked = async (path, hash) => {
  if (!path.startsWith("/assets/"))
    throw Error("Unexpected sampler resource root");
  const local = resolve(assets, path.slice(8));
  if (!local.startsWith(assets + sep)) throw Error("Sampler resource escaped");
  const bytes = await raw(local);
  if (hash && (await sha256(bytes)) !== hash)
    throw Error("Sampler resource bytes differ");
  return bytes;
};
const producer = new LatestDirectNavSceneRenderer({
  renderer: { isWebGLRenderer: true },
  worldNavScene,
  program: await loadDirectNavSceneGpuProgram({
    load: (path) => raw(`${assets}/${path}`),
  }),
});
const rows = [],
  mismatches = [];
try {
  await renderer.loadDefinitions(prepared.definitions);
  for (const material of reflection.materials) {
    let uniforms;
    if (material.kind === "conventional")
      uniforms = renderer.gpuMaterials.get(material.materialKey)?.material
        .uniforms;
    else if (material.kind === "nav-ground")
      uniforms = renderer.navGroundRenderer.bindings.get(
        material.materialKey,
      )?.uniforms;
    else if (material.kind === "ray")
      uniforms = renderer.rayRenderer.bindings.get(
        material.materialKey,
      )?.uniforms;
    else if (material.kind === "static-mesh")
      uniforms = renderer.staticMeshRenderer.bindings.get(
        material.materialKey,
      )?.uniforms;
    else if (material.kind === "nav-producer")
      uniforms =
        producer.materials[material.materialKey.split(":")[1]].uniforms;
    if (!uniforms) throw Error("Actual selected material uniform map missing");
    const assigned = Object.fromEntries(
      Object.entries(uniforms).map(([name, { value }]) => [
        name,
        value?.isTexture
          ? {
              isTexture: true,
              dimension: value.isCubeTexture
                ? "cube"
                : value.isData3DTexture
                  ? "3d"
                  : value.isDataArrayTexture
                    ? "2d-array"
                    : "2d",
              format: value.format,
              type: value.type,
              internalFormat: value.internalFormat ?? null,
              integer:
                value.format === THREE.RedIntegerFormat ||
                value.format === THREE.RGIntegerFormat ||
                value.format === THREE.RGBAIntegerFormat,
              imageWidth: value.image?.width ?? null,
              imageHeight: value.image?.height ?? null,
            }
          : value === null
            ? { pendingProvider: true }
            : { invalidValue: true },
      ]),
    );
    const errors = [];
    for (const sampler of material.activeSamplers) {
      const binding = assigned[sampler.name];
      if (!binding) {
        errors.push("missing-active-sampler:" + sampler.name);
        continue;
      }
      if (binding.pendingProvider) {
        if (!["nav-ground", "nav-producer"].includes(material.kind))
          errors.push("unexpected-pending-sampler:" + sampler.name);
        continue;
      }
      if (!binding.isTexture)
        errors.push("nontexture-active-sampler:" + sampler.name);
      else if (
        sampler.type === "sampler2D" &&
        (binding.dimension !== "2d" || binding.integer)
      )
        errors.push("sampler2D-texture-type-mismatch:" + sampler.name);
      else if (
        sampler.type === "usampler2D" &&
        (!binding.integer || binding.type !== THREE.UnsignedIntType)
      )
        errors.push("usampler2D-texture-type-mismatch:" + sampler.name);
    }
    const row = {
      materialKey: material.materialKey,
      kind: material.kind,
      activeSamplers: material.activeSamplers,
      actualUniforms: assigned,
      errors,
    };
    rows.push(row);
    if (errors.length) mismatches.push(row);
  }
  for (const [path, hash] of Object.entries(inputs))
    if ((await sha256(await Bun.file(path).bytes())) !== hash)
      throw Error("Sampler binding source changed: " + path);
  const output = `${cache}/research/direct-sampler-bindings-v33.json`;
  await Bun.write(
    output,
    JSON.stringify(
      {
        schema: 1,
        kind: "actual-renderer-active-sampler-binding-closure",
        inputs,
        materials: rows,
        mismatches,
        scope: {
          actualOwnedRendererLoaderObjects: true,
          exactNativeActiveSamplerReflection: true,
          navResourcesPendingOwnedCommit: true,
          webGlUniformUploadExecuted: false,
          actualGpuUnitAssignmentsVerified: false,
          browserContextObserved: false,
        },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      output,
      materials: rows.length,
      mismatches: mismatches.length,
      firstMismatches: mismatches
        .map((row) => ({ key: row.materialKey, errors: row.errors }))
        .slice(0, 5),
    }),
  );
  if (mismatches.length)
    throw Error("Actual renderer active sampler binding closure failed");
} finally {
  renderer.dispose();
  producer.dispose();
}
