// Inventory source-owned UBO layouts and group-lifetime demand. No GPU draw.
import { resolve } from "node:path";
import { createParentRenderFrames } from "../latest-parent-render-frame.mjs";
import { directGroundMaterials } from "../latest-direct-ground-policy.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadDirectNavSceneGpuProgram } from "../latest-direct-nav-scene-gpu.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Uniform inventory input changed: " + path);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const publicPath = `${cache}/public`,
  manifestBytes = await raw(`${publicPath}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const bridge = await createParentRenderFrames({
  effectsManifestBytes: manifestBytes,
  quadPackageBytes: await raw(
    `${publicPath}/latest-complete-quad-gpu/package.json`,
  ),
  trailPackageBytes: await raw(`${publicPath}/latest-trail-particles/gpu.json`),
  erosionPackageBytes: await raw(
    `${publicPath}/latest-quad-erosion-gpu/package.json`,
  ),
});
const ground = directGroundMaterials(
  await read(`${publicPath}/latest-direct-ground-materials/package.json`),
  manifest,
  await sha256(manifestBytes),
);
for (const [key, value] of ground) bridge.materials.set(key, value);
const loader = await read(`${cache}/research/direct-renderer-loading.json`),
  worker = await read(
    `${cache}/research/shared-direct-playback-worker-v32-final.json`,
  );
const loadedKeys = loader.summary.loadedKeys,
  groups = new Map(),
  conventional = [],
  programs = [];
async function shader(ref, directory) {
  const bytes = await raw(`${publicPath}/${directory}/${ref.file}`);
  if ((await sha256(bytes)) !== ref.sha256)
    throw Error("Exact prepared shader changed");
  return JSON.parse(new TextDecoder().decode(bytes)).glsl;
}
for (const key of loadedKeys) {
  const binding = bridge.materials.get(key);
  if (!binding)
    throw Error("Actual prepared conventional binding missing: " + key);
  const blocks = binding.prepared.blocks;
  for (const block of blocks) {
    const id = JSON.stringify(block);
    if (!groups.has(id))
      groups.set(id, {
        name: block.glslName,
        size: block.size,
        materialKeys: [],
      });
    groups.get(id).materialKeys.push(key);
  }
  conventional.push({
    key,
    blocks: blocks.map((b) => ({ name: b.glslName, size: b.size })),
  });
  programs.push({
    key,
    kind: "conventional",
    blocks: blocks.map((b) => ({ name: b.glslName, size: b.size })),
    shaders: {
      vertex: await shader(binding.prepared.shaders.vertex, "latest-shaders"),
      pixel: await shader(binding.prepared.shaders.pixel, "latest-shaders"),
    },
  });
}
const nav = await read(
  `${cache}/research/direct-nav-ground-renderer-commands.json`,
);
const layout = (blocks) =>
  blocks.map((b) => ({
    name: b.name,
    stage: b.stage,
    size: b.bytesHex.length / 2,
  }));
const navMaterials = Object.keys(nav.materials).map((key) => {
  const draw = nav.frames
    .flatMap((f) => f.draws)
    .find((draw) => draw.materialKey === key);
  if (!draw)
    throw Error("Owned nav material lacks command-bound uniforms: " + key);
  return { key, blocks: layout(draw.uniformBlocks) };
});
for (const material of navMaterials) {
  const stages = nav.materials[material.key].stages;
  programs.push({
    key: material.key,
    kind: "nav-ground",
    blocks: material.blocks,
    shaders: { vertex: stages[0].glsl, pixel: stages[1].glsl },
  });
}
const ray = await read(`${cache}/research/shared-ray-frame-bindings.json`),
  mesh = await read(`${cache}/research/shared-static-mesh-frame-bindings.json`);
const specialized = new Map(navMaterials.map((m) => [m.key, m.blocks]));
for (const draw of ray.frames.flatMap((f) => f.draws))
  specialized.set(draw.materialKey, layout(draw.uniformBlocks));
for (const draw of mesh.frames.flatMap((f) => f.draws))
  specialized.set(draw.materialKey, layout(draw.particles[0].uniformBlocks));
const dynamic = {};
for (const primitive of ["ray", "static-mesh"]) {
  const frames = worker.snapshots.map((frame) => ({
    time: frame.time,
    groups: frame.draws
      .filter((draw) => draw.primitive === primitive)
      .map((draw) => ({
        key: draw.materialKey,
        sourceEventId: draw.sourceEventId,
        generation: draw.generation,
        particleCount: draw.particleCount,
      })),
  }));
  dynamic[primitive] = {
    peakInstances: Math.max(
      ...frames.map((frame) =>
        frame.groups.reduce(
          (sum, row) =>
            sum + (primitive === "static-mesh" ? row.particleCount : 1),
          0,
        ),
      ),
    ),
    frames,
  };
}
for (const [key, material] of Object.entries(ray.materials))
  programs.push({
    key,
    kind: "ray",
    blocks: specialized.get(key),
    shaders: {
      vertex: material.stages[0].glsl,
      pixel: material.stages[1].glsl,
    },
  });
const meshPackage = await read(
  `${publicPath}/latest-direct-static-mesh-materials/package.json`,
);
for (const program of worker.staticMeshPrograms) {
  const emitter = meshPackage.emitters.find(
      (e) =>
        e.effectId === program.definitionId &&
        e.emitterIndex === program.emitterId,
    ),
    selection = program.meshMaterialSelection;
  const variant = emitter.rows.find((r) => r.hash === selection.passHash)
      .variants[selection.variantIndex],
    key = `${program.definitionId}:${program.emitterId}`;
  programs.push({
    key,
    kind: "static-mesh",
    blocks: specialized.get(key),
    shaders: {
      vertex: await shader(
        variant.shaders.vertex,
        "latest-direct-static-mesh-materials",
      ),
      pixel: await shader(
        variant.shaders.pixel,
        "latest-direct-static-mesh-materials",
      ),
    },
  });
}
const producer = await loadDirectNavSceneGpuProgram({
  load: (path) => raw(`${publicPath}/${path}`),
});
for (const name of ["fade", "blur"])
  programs.push({
    key: `nav-producer:${name}`,
    kind: "nav-producer",
    blocks: [{ name: "Globals_ps", size: 16 }],
    shaders: {
      vertex: "#version 300 es\n" + producer.vertexBody,
      pixel: "#version 300 es\n" + producer[`${name}Body`],
    },
  });
const seenNormal = new Set(),
  seenNav = new Set(),
  sampledDemands = [];
const navKeys = new Set(navMaterials.map((m) => m.key));
for (const frame of worker.snapshots) {
  let transient = 0;
  for (const draw of frame.draws) {
    if (navKeys.has(draw.materialKey)) {
      seenNav.add(draw.materialKey);
      continue;
    }
    if (["ray", "static-mesh"].includes(draw.primitive)) {
      const blocks = specialized.get(draw.materialKey);
      if (!blocks) throw Error("Dynamic UBO layout missing");
      transient +=
        blocks.length *
        (draw.primitive === "static-mesh" ? draw.particleCount : 1);
      continue;
    }
    const binding = bridge.materials.get(draw.materialKey);
    if (!binding)
      throw Error("Actual snapshot material missing: " + draw.materialKey);
    for (const block of binding.prepared.blocks)
      seenNormal.add(JSON.stringify(block));
  }
  const retainedNav = [...seenNav].reduce(
    (sum, key) => sum + specialized.get(key).length,
    0,
  );
  sampledDemands.push({
    time: frame.time,
    conventional: seenNormal.size,
    navGround: retainedNav,
    navProducer: 2,
    transient,
    potentialAllocatedGroups: seenNormal.size + retainedNav + 2 + transient,
  });
}
const limits = await read(`${cache}/research/native-uniform-limits.json`);
const output = `${cache}/research/direct-uniform-inventory.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "prepared-conventional-uniform-group-and-retained-draw-inventory",
      inputs,
      conventional: {
        materials: conventional.length,
        uniqueGroups: groups.size,
        groups: [...groups.values()],
        layouts: conventional,
      },
      navMaterials,
      dynamic,
      specializedLayouts: [...specialized].map(([key, blocks]) => ({
        key,
        blocks,
      })),
      maxPerProgramBlocks: Math.max(
        ...conventional.map((m) => m.blocks.length),
        ...[...specialized.values()].map((b) => b.length),
      ),
      programs,
      nativeLimits: limits.limits,
      sampledDemands,
      peakSampledPotentialGroupDemand: Math.max(
        ...sampledDemands.map((f) => f.potentialAllocatedGroups),
      ),
      scope: {
        originalGroupJsonDedupApplied: true,
        immutableV32ActualWorkerCohort: true,
        browserAllocationPeakMeasured: false,
        webglBackendExecuted: false,
        sampledGroupDemandIncludesAllPacketMeshes: true,
        visibilityAndPriorFrameDisposalCanChangeAllocationInstant: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    conventionalMaterials: conventional.length,
    uniqueGroups: groups.size,
    navMaterials,
    dynamicPeaks: Object.fromEntries(
      Object.entries(dynamic).map(([name, value]) => [
        name,
        value.peakInstances,
      ]),
    ),
  }),
);
