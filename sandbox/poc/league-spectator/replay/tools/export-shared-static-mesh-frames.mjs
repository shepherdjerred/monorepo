// Offline diagnostic consumer of the same retained worker records and owned
// material binder as THREE. This never advances a particle or runs guest code.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestDirectStaticMeshPackage } from "../latest-direct-static-mesh-package.mjs";
import { directStaticMeshScene } from "../latest-direct-static-mesh-scene.mjs";
import { directStaticMeshDrawParameters } from "../latest-direct-effect-mesh-record.mjs";
import { directNativeMetalRasterToGles } from "../latest-native-raster-conventions.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
if (!process.argv[3]) throw Error("Explicit diagnostic scene JSON required");
const inputs = {};
async function raw(path) {
  path = resolve(path);
  const b = await Bun.file(path).bytes(),
    h = await sha256(b);
  if (inputs[path] && inputs[path] !== h)
    throw Error("Shared static mesh binder input drift");
  inputs[path] = h;
  return b;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const sceneInput = await read(process.argv[3]);
const scene = sceneInput.bySource ? null : directStaticMeshScene(sceneInput);
const report = await read(
    process.argv[4] ?? `${cache}/research/shared-direct-playback-worker.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  manifestBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(report.scope.actualDecodedReplayRequests, true);
assert.equal(report.controls.identical1x4xCheckpoint, true);
for (const [path, hash] of Object.entries(report.inputs))
  assert.equal(
    await sha256(await raw(path)),
    hash,
    "Shared worker input changed",
  );
assert.ok(Array.isArray(report.staticMeshPrograms));
const records = [];
for (const id of new Set(
  report.staticMeshPrograms.map((p) => p.definitionId),
)) {
  const ref = manifest.definitions[id];
  assert.ok(ref);
  const b = await raw(`${cache}/public/latest-effects/${ref.file}`);
  assert.equal(await sha256(b), ref.sha256);
  records.push({
    id,
    definition: JSON.parse(new TextDecoder().decode(b)).definition,
  });
}
const pkg = await loadLatestDirectStaticMeshPackage({
  load: (file) => raw(`${cache}/public/${file}`),
  profile,
  manifestBytes,
  records,
});
const programs = new Map();
const rasterStates = {};
for (const p of report.staticMeshPrograms) {
  const key = `${p.definitionId}:${p.emitterId}`;
  assert.equal(p.materialKey, key);
  assert.ok(!programs.has(key));
  const token = pkg.tokens.get(key);
  assert.ok(token);
  const selected = pkg.materials.inspectNonInstanced(token);
  assert.equal(selected.meshPath, p.meshProgram.resource.path);
  assert.equal(selected.vertexSha256, p.meshProgram.resource.vertices.sha256);
  assert.deepEqual(selected, p.meshMaterialSelection);
  rasterStates[p.materialKey] = directNativeMetalRasterToGles(
    selected.pipeline,
    { targetViewportOrigin: "lower-left", clipY: "unchanged" },
  );
  programs.set(key, p);
}
const frames = [];
for (const frame of report.snapshots) {
  const draws = [];
  for (const draw of frame.draws.filter((d) => d.primitive === "static-mesh")) {
    const drawScene =
      scene ?? directStaticMeshScene(sceneInput.bySource[draw.sourceEventId]);
    const program = programs.get(draw.materialKey);
    assert.ok(program);
    assert.equal(program.definitionId, draw.definitionId);
    assert.equal(program.emitterId, draw.emitterId);
    assert.ok(
      Number.isSafeInteger(draw.particleCount) && draw.particleCount >= 0,
    );
    const records = Uint8Array.fromHex(draw.geometry.meshRecordsHex);
    assert.equal(records.length, draw.particleCount * 176);
    const particles = [];
    for (let i = 0; i < draw.particleCount; i++) {
      const bound = pkg.materials.bindNonInstanced(
        pkg.tokens.get(draw.materialKey),
        {
          drawParameters: directStaticMeshDrawParameters({
            record: records.subarray(i * 176, (i + 1) * 176),
            resourceOffset40: program.meshProgram.resourceFields.offset40,
            paletteByte: 0,
            multTexturePresent: false,
          }),
          matrixOrder: "post-1916f70",
          individualMode: 0,
          scene: drawScene,
        },
      );
      assert.equal(bound.status, "bound-noninstanced-static-mesh-inputs");
      particles.push({
        uniformBlocks: bound.uniforms.map((b) => ({
          stage: b.stage,
          name: b.name,
          binding: b.binding,
          bytesHex: b.bytes.toHex(),
        })),
        inactiveApiBindings: bound.inactiveApiBindings,
      });
    }
    draws.push({
      sourceEventId: draw.sourceEventId,
      generation: draw.generation,
      definitionId: draw.definitionId,
      emitterId: draw.emitterId,
      materialKey: draw.materialKey,
      particleCount: draw.particleCount,
      particles,
    });
  }
  frames.push({ time: frame.time, draws });
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    "Final shared static mesh binder drift",
  );
const output = process.argv[5]
  ? resolve(process.argv[5])
  : `${cache}/research/shared-static-mesh-frame-bindings.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-shared-worker-static-mesh-material-bindings",
      inputs,
      frames,
      rasterStates,
      scene,
      scope: {
        sameOwnedMaterialBinderAsMainRenderer: true,
        samePostSetterDrawParameterHelper: true,
        workerRecordsUnchanged: true,
        scenePolicyExplicit: true,
        nativeAcceptance: null,
        browserExecuted: false,
      },
    },
    (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v),
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    inputs: Object.keys(inputs).length,
    frames: frames.length,
    meshDraws: frames.reduce((n, f) => n + f.draws.length, 0),
  }),
);
