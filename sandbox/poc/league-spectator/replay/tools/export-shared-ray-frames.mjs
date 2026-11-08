// Diagnostic consumer of the same owned material factory as the main viewer.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestDirectRayPackage } from "../latest-direct-ray-package.mjs";
import { directRayScene } from "../latest-direct-ray-scene.mjs";
import { directNativeMetalRasterToGles } from "../latest-native-raster-conventions.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
if (!process.argv[3])
  throw Error("Explicit diagnostic Ray scene JSON required");
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    hash = await sha256(b);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Ray binding input drift");
  inputs[path] = hash;
  return b;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const sceneInput = await read(process.argv[3]),
  report = await read(
    process.argv[4] ?? `${cache}/research/shared-direct-playback-worker.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(report.scope.actualDecodedReplayRequests, true);
assert.equal(report.controls.identical1x4xCheckpoint, true);
for (const [path, hash] of Object.entries(report.inputs))
  assert.equal(await sha256(await raw(path)), hash, "Worker Ray input changed");
assert.ok(Array.isArray(report.rayPrograms));
const records = [];
for (const id of new Set(report.rayPrograms.map((p) => p.definitionId))) {
  const ref = manifest.definitions[id];
  assert.ok(ref);
  const b = await raw(`${cache}/public/latest-effects/${ref.file}`);
  assert.equal(await sha256(b), ref.sha256);
  records.push({
    id,
    definition: JSON.parse(new TextDecoder().decode(b)).definition,
  });
}
const pkg = await loadLatestDirectRayPackage({
  load: (file) => raw(`${cache}/public/${file}`),
  profile,
  manifestBytes,
  records,
});
const programs = new Map(),
  rasterStates = {},
  materials = {},
  frames = [];
for (const p of report.rayPrograms) {
  const key = `${p.definitionId}:${p.emitterId}`;
  assert.equal(p.materialKey, key);
  assert.ok(!programs.has(key));
  const selected = pkg.materials.inspect(pkg.tokens.get(key));
  assert.deepEqual(selected, p.rayMaterialSelection);
  rasterStates[key] = directNativeMetalRasterToGles(selected.pipeline, {
    targetViewportOrigin: "lower-left",
    clipY: "unchanged",
  });
  programs.set(key, p);
}
for (const frame of report.snapshots) {
  const draws = [];
  for (const draw of frame.draws.filter((d) => d.primitive === "ray")) {
    const p = programs.get(draw.materialKey);
    assert.ok(p);
    assert.equal(p.definitionId, draw.definitionId);
    assert.equal(p.emitterId, draw.emitterId);
    const scene = directRayScene(
        sceneInput.bySource
          ? sceneInput.bySource[draw.sourceEventId]
          : sceneInput,
      ),
      b = pkg.materials.bind(pkg.tokens.get(draw.materialKey), scene);
    assert.equal(b.status, "bound-explicit-scene-ray-material");
    materials[draw.materialKey] ??= {
      stages: b.stages,
      textures: b.textures.map((t) => ({
        metadata: t.metadata,
        levelsHex: t.levels.map((level) => level.map((plane) => plane.toHex())),
      })),
      sceneTextures: Object.fromEntries(
        Object.entries(b.sceneTextures).map(([name, t]) => [
          name,
          { ...t, rgba: undefined, rgbaHex: t.rgba.toHex() },
        ]),
      ),
      pipeline: b.pipeline,
      omissions: b.omissions,
    };
    draws.push({
      sourceEventId: draw.sourceEventId,
      generation: draw.generation,
      definitionId: draw.definitionId,
      emitterId: draw.emitterId,
      materialKey: draw.materialKey,
      particleCount: draw.particleCount,
      uniformBlocks: b.uniforms.map((u) => ({
        stage: u.stage,
        name: u.name,
        binding: u.binding,
        bytesHex: u.bytes.toHex(),
      })),
    });
  }
  frames.push({ time: frame.time, draws });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final Ray binding drift",
  );
const output = resolve(
  process.argv[5] ?? `${cache}/research/shared-ray-frame-bindings.json`,
);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-shared-worker-ray-material-bindings",
      inputs,
      frames,
      materials,
      rasterStates,
      scope: {
        sameOwnedMaterialBinderAsMainRenderer: true,
        workerGeometryUnchanged: true,
        scenePolicyExplicit: true,
        browserExecuted: false,
        nativeAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    inputs: Object.keys(inputs).length,
    frames: frames.length,
    rayDraws: frames.reduce((n, f) => n + f.draws.length, 0),
  }),
);
