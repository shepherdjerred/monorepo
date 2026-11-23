// Exercise original recorded events through the ordinary preparation and
// runtime owners. Camera choice is diagnostic; effect placement is never given.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareDirectReplayFromFiles } from "./direct-replay-preparation.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [configArg] = process.argv.slice(2);
if (!configArg)
  throw Error(
    "Usage: bun inspect-recorded-material-activation.mjs <explicit-config.json>",
  );
const sourceSha256 = sha(await Bun.file(import.meta.path).bytes()),
  configBytes = await Bun.file(configArg).bytes(),
  config = JSON.parse(new TextDecoder().decode(configBytes));
assert(
  typeof config.effectId === "string" &&
    Number.isSafeInteger(config.emitterIndex) &&
    config.emitterIndex >= 0 &&
    Number.isSafeInteger(config.expectedCreations) &&
    config.expectedCreations > 0,
  "Explicit recorded effect/emitter and count required",
);
const result = await prepareDirectReplayFromFiles({
  ...config,
  onPreparation: (event) =>
    console.log(JSON.stringify({ phase: "preparation", ...event })),
});
const definition = result.live.prepared.definitions.get(config.effectId),
  program = definition?.emitters.find(
    (row) => row.index === config.emitterIndex,
  );
assert(
  program,
  "Selected actual emitter must compile with its source unchanged",
);
assert.equal(
  definition.blockers.length,
  0,
  "Selected definition has unresolved system blockers",
);
const events = result.runtimeInputs.events.filter(
  (event) => event.kind === "create" && event.definitionId === config.effectId,
);
assert.equal(
  events.length,
  config.expectedCreations,
  "Recorded event count differs",
);
assert(
  !events.some((event) => event.placement?.kind === "explicit-world"),
  "Supplied effect placement cannot prove recorded activation",
);
const runtime = new result.api.LatestDirectEffectRuntime(result.runtimeInputs),
  THREE = await import(pathToFileURL(resolve(config.threeModule)).href),
  world = new THREE.Group(),
  camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 50000);
camera.position.set(7400, 15000, 15000);
camera.lookAt(7400, 0, 7400);
camera.updateMatrixWorld(true);
camera.updateProjectionMatrix();
const renderer = new result.api.LatestDirectEffectRenderer(
  world,
  result.manifest,
  result.live.manifestBytes,
  {
    staticCatalog: result.staticCatalog,
    selectedMaterials: result.live.prepared.selectedMaterials,
    perspective: "all",
  },
);
const rows = [];
let restoreProof = null;
let rendererNegativeControls = 0;
let vertices = 0,
  bytes = 0,
  nonempty = 0,
  unsubmittedOtherDraws = 0;
try {
  const initialization = result.live.makeWorkerInitialization();
  const restored = await result.api.restoreLatestDirectCompiledDefinitions(
    initialization.payload,
    { staticCatalog: result.staticCatalog },
  );
  assert.equal(
    restored.definitions.size,
    result.live.prepared.definitions.size,
  );
  for (const perspective of [undefined, "blue", "red"])
    await assert.rejects(
      () =>
        result.api.restoreLatestDirectCompiledDefinitions(
          {
            ...initialization.payload,
            contract: { ...initialization.payload.contract, perspective },
          },
          { staticCatalog: result.staticCatalog },
        ),
      /all-vision/,
    );
  restoreProof = {
    definitions: restored.definitions.size,
    negativePerspectives: 3,
    contract: initialization.payload.contract,
  };
  // The renderer receives the actual compiled definition, including every
  // admitted sibling. Only this source effect is selected for this proof.
  await renderer.loadDefinitions(new Map([[definition.id, definition]]));
  for (const perspective of [undefined, "blue", "red"]) {
    const foreignWorld = new THREE.Group();
    assert.throws(
      () =>
        new result.api.LatestDirectEffectRenderer(
          foreignWorld,
          result.manifest,
          result.live.manifestBytes,
          {
            staticCatalog: result.staticCatalog,
            selectedMaterials: result.live.prepared.selectedMaterials,
            perspective,
          },
        ),
      /another perspective/,
    );
    assert.equal(foreignWorld.children.length, 0);
    rendererNegativeControls++;
  }
  const actualMaterial = renderer.gpuMaterials.get(program.materialKey),
    actualFog = Object.values(actualMaterial.prepared.textures).find(
      (binding) => binding.kind === "original-all-vision-fog-texture",
    );
  assert(actualFog, "Bound original all-vision resource required");
  for (const changed of [
    { ...actualFog, rgba: [0, ...actualFog.rgba.slice(1)] },
    { ...actualFog, authoritySha256: "0".repeat(64) },
    { ...actualFog, perspective: "blue" },
  ]) {
    await assert.rejects(
      () => renderer.gpuTexture(changed),
      /not referenced by an owned all-vision material/,
    );
    rendererNegativeControls++;
  }
  for (const event of events) {
    const time = event.time + 1 / 20;
    runtime.advanceTo(time);
    const packet = runtime.generateDraws({
        right: [1, 0, 0],
        up: [0, 1, 0],
        position: [7400, 15000, 15000],
      }),
      selected = packet.draws.filter(
        (draw) => draw.definitionId === config.effectId,
      ),
      draw = selected.find(
        (draw) =>
          draw.sourceEventId === event.id &&
          draw.emitterId === config.emitterIndex,
      ),
      ledger = runtime.ledger.get(event.id);
    assert(
      ledger?.placementResolved && ledger.runtimeActivated,
      "Recorded source event did not activate: " + event.id,
    );
    assert(
      ledger.initialComponentWorldInputs.some(
        (row) => row.index === config.emitterIndex && row.resolved,
      ),
      "Original component world inputs unresolved: " + event.id,
    );
    assert(
      draw && draw.particleCount > 0,
      "Activated recorded event generated no selected geometry: " + event.id,
    );
    const geometry = directGeometryBuffers(draw);
    assert(
      geometry.vertices.length > 0 && geometry.indices.length > 0,
      "Nonempty material geometry required",
    );
    unsubmittedOtherDraws += packet.draws.length - selected.length;
    renderer.commitDirect({ ...packet, draws: selected }, camera);
    const material = renderer.gpuMaterials.get(draw.materialKey);
    assert(
      material?.material.isRawShaderMaterial,
      "Real original material-backed shader object required",
    );
    const fog = Object.entries(material.prepared.textures).filter(
      ([, binding]) => binding.kind === "original-all-vision-fog-texture",
    );
    assert(
      fog.length > 0,
      "Selected actual material must use native all-vision FoW",
    );
    for (const [uniform, binding] of fog) {
      const texture = material.material.uniforms[uniform].value;
      assert(
        texture.isDataTexture &&
          texture.minFilter === THREE.LinearFilter &&
          texture.magFilter === THREE.LinearFilter &&
          texture.wrapS === THREE.ClampToEdgeWrapping &&
          texture.wrapT === THREE.ClampToEdgeWrapping,
        "Original FoW GPU texture/sampler properties differ",
      );
      assert.deepEqual([...texture.image.data], binding.rgba);
    }
    const displayed = [...renderer.directMeshes.values()].filter(
      (mesh) => mesh.visible,
    );
    assert(
      displayed.length > 0,
      "Actual direct-renderer geometry object required",
    );
    vertices += geometry.vertices.length / 28;
    bytes += geometry.vertices.length + geometry.indices.length;
    nonempty++;
    rows.push({
      eventId: event.id,
      time: event.time,
      sampleTime: time,
      transportSequence: event.transportSequence,
      entryOrder: event.entryOrder,
      placementEvidence: ledger.placementEvidence,
      eligibleComponents: ledger.eligibleComponentCount,
      runtimeActivated: ledger.runtimeActivated,
      materialKey: draw.materialKey,
      particleCount: draw.particleCount,
      vertices: geometry.vertices.length / 28,
      vertexSha256: sha(geometry.vertices),
      indexSha256: sha(geometry.indices),
      originalAllVisionFogAuthoritySha256: fog[0][1].authoritySha256,
    });
    console.log(
      JSON.stringify({
        phase: "activation",
        eventId: event.id,
        time,
        particles: draw.particleCount,
      }),
    );
  }
} finally {
  renderer.dispose();
}
await result.assertInputsUnchanged();
assert.equal(
  sha(await Bun.file(import.meta.path).bytes()),
  sourceSha256,
  "Recorded activation producer changed",
);
assert.equal(
  sha(await Bun.file(configArg).bytes()),
  sha(configBytes),
  "Recorded activation config changed",
);
const output = join(
    resolve(config.outputDirectory),
    "recorded-material-activation.json",
  ),
  proof = {
    schema: 1,
    kind: "actual-recorded-material-backed-particle-activation",
    sourceSha256,
    configSha256: sha(configBytes),
    replaySha256: result.report.replaySha256,
    effectId: config.effectId,
    emitterIndex: config.emitterIndex,
    events: result.runtimeInputs.events.length,
    creations: events.length,
    activated: nonempty,
    vertices,
    packedBytes: bytes,
    unsubmittedOtherDraws,
    rows,
    restoreProof,
    rendererNegativeControls,
    sourceDrift: 0,
    inputs: result.inputs,
    scope: {
      ordinarySessionPreparation: true,
      allOriginalEventsRetained: true,
      originalPresentationWorld: true,
      suppliedPlacement: false,
      compiledSourcesAltered: false,
      realThreeMaterialTextureAndGeometryObjects: true,
      explicitPerspective: "all",
      teamFogAdmitted: false,
      webGlSubmitted: false,
      browserExecuted: false,
      nativeSpectatorAdmitted: false,
    },
  };
await Bun.write(output, JSON.stringify(proof));
console.log(
  JSON.stringify({
    output,
    creations: events.length,
    activated: nonempty,
    vertices,
    packedBytes: bytes,
    nativeSpectatorAdmitted: false,
  }),
);
