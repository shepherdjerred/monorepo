// Actual THREE resource objects and source-owned allocation/geometry methods.
// No browser, WebGL backend, framebuffer completeness or GPU draw claim.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { DirectNavmeshProducer } from "../latest-direct-navmesh-producer.mjs";
import { validateDirectNavSceneGpuPasses } from "../latest-direct-nav-scene-gpu.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Nav resource source changed: " + path);
  inputs[path] = hash;
  return bytes;
}
const text = async (path) =>
  new TextDecoder("utf-8", { fatal: true }).decode(await raw(path));
await captureDirectSourceInputs([import.meta.path], raw);
const corePath = `${cache}/public/vendor/three.core.js`;
await raw(corePath);
const THREE = await import(pathToFileURL(corePath).href),
  root = resolve(import.meta.dir, "..");
const source = await text(`${root}/latest-direct-nav-scene-renderer.mjs`);
const begin = source.indexOf("  initialize(initialization) {"),
  end = source.indexOf("\n  execute(", begin);
assert(
  begin >= 0 && end > begin,
  "Unique actual resource initialization method required",
);
const initializationBody = source.slice(begin, end),
  body = initializationBody.slice(
    initializationBody.indexOf("{") + 1,
    initializationBody.lastIndexOf("}"),
  );
const packageBytes = await raw(
    `${cache}/public/latest-direct-nav-scene/package.json`,
  ),
  pkg = JSON.parse(new TextDecoder().decode(packageBytes));
const n = pkg.navigation,
  producer = new DirectNavmeshProducer({
    width: n.width,
    height: n.height,
    highResolution: true,
  });
const rgba = Uint8Array.fromHex(n.rgbaHex),
  resources = producer.resources(),
  plan = producer.update({
    now: 0,
    rgba,
    dirty: true,
    force: true,
    modeUpdatesEnabled: true,
  });
const uploads = [],
  host = {
    resources: null,
    renderer: {
      initTexture(texture) {
        assert.equal(texture.isTexture, true);
        uploads.push(texture.uuid);
      },
    },
  };
new Function("THREE", "initialization", body).call(host, THREE, {
  resources,
  plan,
});
assert.equal(host.resources.textures.size, 4);
assert.equal(host.resources.targets.size, 2);
const textures = [...host.resources.textures.values()],
  targets = [...host.resources.targets.values()];
assert.equal(new Set(textures).size, 4);
assert.equal(new Set(textures.map((t) => t.uuid)).size, 4);
assert.notEqual(targets[0], targets[1]);
assert.notEqual(targets[0].texture, targets[1].texture);
for (const id of ["mask-a", "mask-b"])
  assert(!targets.some((t) => t.texture === host.resources.textures.get(id)));
const next = producer.update({
  now: 0.25,
  rgba,
  dirty: false,
  force: false,
  modeUpdatesEnabled: true,
});
validateDirectNavSceneGpuPasses({
  plan: next,
  metadata: { width: resources.width, height: resources.height },
});
const passes = next.passes.map((pass, index) => {
  const target = host.resources.targets.get(pass.target),
    sampled = Object.values(pass.textures).map((id) =>
      host.resources.textures.get(id),
    );
  assert(target && sampled.every(Boolean));
  assert(sampled.every((texture) => texture !== target.texture));
  return {
    index,
    shader: pass.shader,
    target: pass.target,
    sampledIds: Object.values(pass.textures),
    sameTextureReadWrite: false,
  };
});
const geometryCases = [];
for (const name of [
  "latest-direct-nav-ground-renderer.mjs",
  "latest-direct-ray-renderer.mjs",
  "latest-direct-static-mesh-renderer.mjs",
]) {
  const s = await text(`${root}/${name}`),
    a = s.indexOf("function geometry("),
    z = s.indexOf("\nfunction ", a + 1);
  assert(a >= 0 && z > a, "Actual indexed geometry factory required");
  const factory = new Function("THREE", `${s.slice(a, z)};return geometry;`)(
    THREE,
  );
  const bound = name.includes("static-mesh")
    ? {
        vertices: new Uint8Array(108),
        attributes: [
          {
            glslName: "a_POSITION",
            type: "float32",
            components: 3,
            offset: 0,
            normalized: false,
          },
        ],
      }
    : {
        a_POSITION: new Float32Array(12),
        a_COLOR: new Uint8Array(16),
        a_TEXCOORD: new Uint16Array(16),
        a_TEXCOORD1: new Uint16Array(8),
        index: Uint16Array.of(0, 1, 2, 0, 2, 3),
      };
  const geometry = factory(bound);
  assert.equal(geometry.isBufferGeometry, true);
  assert(geometry.index && geometry.index.count > 0);
  assert.equal(geometry.attributes.position, undefined);
  geometryCases.push({
    source: name,
    actualSourceFactoryExecuted: true,
    indexed: true,
    indexCount: geometry.index.count,
    standardPositionAbsent: true,
  });
  geometry.dispose();
}
const indexedSources = [];
for (const name of [
  "latest-vfx-bound-renderer.mjs",
  "latest-trail-renderer.mjs",
]) {
  const s = await text(`${root}/${name}`);
  assert(s.includes(".setIndex(new THREE.BufferAttribute("));
  indexedSources.push({
    source: name,
    reviewedIndexedGeometrySource: true,
    fullFactoryExecutedHere: false,
  });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash, path);
const output = `${cache}/research/nav-resource-alias-audit.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "three-nav-resource-identity-and-indexed-geometry-audit",
      inputs,
      resources: {
        width: resources.width,
        height: resources.height,
        textureObjects: textures.length,
        targetObjects: targets.length,
        allTextureObjectsDistinct: true,
        actualThreeInitializationMethodExecuted: true,
        initialUploadCalls: uploads.length,
      },
      passes,
      geometryCases,
      indexedSources,
      scope: {
        actualThreeCoreObjects: true,
        explicitTextureUploadHost: true,
        logicalSamplerTargetAliasing: false,
        actualWebGlFramebufferHandlesInspected: false,
        webGlRendererBackendExecuted: false,
        browserAcceptance: false,
        groundWarmCompileGeometryNotDrawn: true,
      },
    },
    null,
    2,
  ),
);
for (const target of targets) target.dispose();
for (const texture of textures) texture.dispose();
console.log(
  JSON.stringify({
    output,
    distinctTextures: 4,
    distinctTargets: 2,
    feedbackFreePasses: passes.length,
    indexedFactories: geometryCases.length,
  }),
);
