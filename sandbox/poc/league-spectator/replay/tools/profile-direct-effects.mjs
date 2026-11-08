import { resolve } from "node:path";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
import { compileLatestDirectEffect } from "../latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "../latest-direct-effect-worker.mjs";
import { selectNativeComparedInventory } from "./direct-effect-inventory.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

// An active-particle load control, separate from match coverage and browser FPS.
// Only components already compared to native geometry enter each cohort.
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const startedAt = new Date().toISOString();
const executionContextPrefix = "--execution-context=";
const executionContextNote =
  process.argv
    .find((argument) => argument.startsWith(executionContextPrefix))
    ?.slice(executionContextPrefix.length) ?? null;
const cameraMode = process.argv.includes("--camera");
const loadedMode = process.argv.includes("--loaded");
const angularMode = process.argv.includes("--angular");
const motionMode = process.argv.includes("--motion");
const blendMode = process.argv.includes("--blend");
const groundMode = process.argv.includes("--ground");
const trailMode = process.argv.includes("--trail");
const inventoryWithTrails = process.argv.includes("--inventory-with-trails");
const verifyInventory = process.argv.includes("--verify-inventory");
const inventoryMode =
  process.argv.includes("--inventory") ||
  inventoryWithTrails ||
  verifyInventory;
const bendingWorld = trailMode || inventoryWithTrails;
if (
  [
    cameraMode,
    loadedMode,
    angularMode,
    motionMode,
    blendMode,
    groundMode,
    trailMode,
    inventoryMode,
  ].filter(Boolean).length > 1
)
  throw Error("Choose a single native primitive cohort");
const inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  const digest = await sha256(raw);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed during load control: ${path}`);
  inputs[path] = digest;
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
await captureDirectSourceInputs(
  [
    import.meta.path,
    ...(bendingWorld
      ? [resolve(import.meta.dir, "profile-direct-effects-worker.mjs")]
      : []),
  ],
  bytes,
);
for (const file of [
  "latest-direct-effect-runtime.mjs",
  "latest-direct-effect-definition.mjs",
  "latest-direct-effect-birth.mjs",
  "latest-direct-effect-audio.mjs",
  "latest-direct-effect-position.mjs",
  "latest-direct-effect-world-inputs.mjs",
  "latest-direct-effect-flex.mjs",
  "latest-direct-effect-orientation.mjs",
  "latest-direct-effect-soft.mjs",
  "latest-direct-effect-sprite.mjs",
  "latest-direct-particle-palette.mjs",
  "latest-direct-effect-worker.mjs",
  "latest-direct-effect-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-direct-effect-defaults.mjs",
  "latest-direct-effect-camera.mjs",
  "latest-direct-effect-camera-table.mjs",
  "latest-direct-ground-contract.mjs",
  "latest-direct-ground-policy.mjs",
  "tools/profile-direct-effects.mjs",
  "tools/direct-effect-inventory.mjs",
])
  await bytes(resolve(import.meta.dir, "..", file));
const assets = `${cache}/public`;
const profile = await read(`${assets}/decoder-16.21-macos/profile.json`);
const packages = Object.fromEntries(
  await Promise.all(
    ["values", "birth", "emission", "samplers"].map(async (name) => [
      name,
      await bytes(`${assets}/decoder-16.21-macos/vfx-${name}.json`),
    ]),
  ),
);
const proofNames = inventoryMode
  ? [
      "point",
      "loaded",
      "camera",
      "angular",
      "position",
      "motion",
      "blend",
      "ground",
      ...(inventoryWithTrails ? ["trail"] : []),
    ]
      .map((name) => `direct-${name}-schedule-comparison`)
      .concat(
        inventoryWithTrails
          ? [
              "direct-particle-orientation-schedule-comparison",
              "direct-integrated-rotation-schedule-comparison",
              "direct-soft-particles-schedule-comparison",
              "direct-quad-uv-schedule-comparison",
            ]
          : [],
      )
  : [
      trailMode
        ? "direct-trail-schedule-comparison"
        : groundMode
          ? "direct-ground-schedule-comparison"
          : blendMode
            ? "direct-blend-schedule-comparison"
            : motionMode
              ? "direct-motion-schedule-comparison"
              : cameraMode
                ? "direct-camera-schedule-comparison"
                : angularMode
                  ? "direct-angular-schedule-comparison"
                  : loadedMode
                    ? "direct-loaded-schedule-comparison"
                    : "direct-effect-kernels",
    ];
const proofs = [];
for (const name of proofNames) {
  const report = await read(`${cache}/research/${name}.json`);
  if (report.mismatches.length)
    throw Error("Passing native geometry comparisons required");
  for (const [path, expected] of Object.entries(report.inputs))
    if ((await sha256(await bytes(path))) !== expected)
      throw Error(`Stale load-control comparison: ${path}`);
  proofs.push({ name, report });
}
const proof = proofs[0].report;
let worldControl = null;
if (bendingWorld) {
  worldControl = await read(`${cache}/research/direct-load-world-control.json`);
  if (
    worldControl.nativeFrames !== 732 ||
    worldControl.translatedQueries !== 1464 ||
    worldControl.scope?.originalMatchWorldPlacement !== false
  )
    throw Error("Native-compared supplied bending world required");
  for (const [path, h] of Object.entries(worldControl.inputs))
    if ((await sha256(await bytes(path))) !== h)
      throw Error(`Stale supplied bending world: ${path}`);
}
let inventory = null;
if (inventoryMode) {
  const admission = await read(`${cache}/research/direct-effects.json`);
  for (const [file, expected] of Object.entries(admission.inputs.producers))
    if (
      (await sha256(await bytes(resolve(import.meta.dir, "..", file)))) !==
      expected
    )
      throw Error(`Stale combined inventory admission: ${file}`);
  if (inventoryWithTrails) {
    for (const name of [
      "direct-trail-schedule-comparison",
      "direct-particle-orientation-schedule-comparison",
      "direct-integrated-rotation-schedule-comparison",
      "direct-soft-particles-schedule-comparison",
      "direct-quad-uv-schedule-comparison",
    ]) {
      const additionalProof = proofs.find((p) => p.name === name).report;
      for (const row of additionalProof.cases) {
        let definition = admission.definitions.find(
          (d) => d.id === row.effectId,
        );
        if (!definition) {
          definition = { id: row.effectId, supported: [] };
          admission.definitions.push(definition);
        }
        if (!definition.supported.includes(row.emitterIndex))
          definition.supported.push(row.emitterIndex);
      }
    }
  }
  inventory = selectNativeComparedInventory(admission, proofs);
}
const manifestBytes = await bytes(`${assets}/latest-effects/manifest.json`);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const contentHash = await sha256(manifestBytes);
const kernels = await createDirectEffectKernels({ profile, packages });
const definitions = new Map();
const sourceDefinitions = new Map();
const seen = new Set();
// Simulation load must include verified components even when the selected
// native geometry has no positive-area visual sample.
const verifiedComponents =
  inventory?.components ??
  (Array.isArray(proof.cases)
    ? proof.cases.map((sample) => ({
        ...sample,
        shaderKey: `${sample.effectId}:${sample.emitterIndex}`,
      }))
    : proof.comparisons);
for (const sample of verifiedComponents) {
  if (seen.has(sample.shaderKey)) continue;
  seen.add(sample.shaderKey);
  const key = sample.shaderKey.split(":").at(-1);
  const index = Number(key);
  const ref = manifest.definitions[sample.effectId];
  const raw = await bytes(`${assets}/latest-effects/${ref.file}`);
  if ((await sha256(raw)) !== ref.sha256)
    throw Error("Load-control definition hash differs");
  let compiled = definitions.get(sample.effectId);
  if (!compiled) {
    const sourceDefinition = await compileLatestDirectEffect({
      id: sample.effectId,
      definitionBytes: raw,
      manifest,
      manifestBytes,
      kernels,
    });
    sourceDefinitions.set(sample.effectId, sourceDefinition);
    if (
      inventoryMode &&
      JSON.stringify(
        sourceDefinition.emitters
          .map((emitter) => emitter.index)
          .sort((a, b) => a - b),
      ) !==
        JSON.stringify(
          inventory.components
            .filter((component) => component.effectId === sample.effectId)
            .map((component) => component.emitterIndex)
            .sort((a, b) => a - b),
        )
    )
      throw Error(
        `Admission inventory differs from compiled components: ${sample.effectId}`,
      );
    compiled = {
      id: sample.effectId,
      build: manifest.build,
      protocol: manifest.protocol,
      contentHash,
      programVersion: sourceDefinition.programVersion,
      systemIdentity: sourceDefinition.systemIdentity,
      systemFlags: sourceDefinition.systemFlags,
      systemAudio: sourceDefinition.systemAudio,
      systemOmissions: sourceDefinition.systemOmissions,
      childResourceAncestryRequired:
        sourceDefinition.childResourceAncestryRequired,
      unsupported: [],
      blockers: [],
      emitters: [],
    };
    definitions.set(compiled.id, compiled);
  }
  if (inventoryMode || groundMode || trailMode) {
    const program = sourceDefinitions
      .get(sample.effectId)
      .emitters.find((emitter) => emitter.index === index);
    if (!program || program.materialKey !== sample.shaderKey)
      throw Error(
        `Combined inventory differs from current compiled program: ${sample.shaderKey}`,
      );
    compiled.emitters.push(program);
    continue;
  }
  const source = normalizeDirectPointEmitter(
    JSON.parse(new TextDecoder().decode(raw)).definition
      .complexEmitterDefinitionData[index],
  );
  const sourceProgram = sourceDefinitions
    .get(sample.effectId)
    .emitters.find((emitter) => emitter.index === index);
  if (!sourceProgram)
    throw Error(
      `Manual load control requires a compiled component: ${sample.shaderKey}`,
    );
  compiled.emitters.push({
    index,
    source,
    placementRequirements: sourceProgram.placementRequirements,
    integratedRotation: sourceProgram.integratedRotation,
    softParticlePolicy: sourceProgram.softParticlePolicy,
    spriteProgram: sourceProgram.spriteProgram,
    paletteProgram: sourceProgram.paletteProgram,
    paletteTexture: sourceProgram.paletteTexture,
    lifecycleProgram: sourceProgram.lifecycleProgram,
    singleResourceProgram: sourceProgram.singleResourceProgram,
    blend: source.blendMode,
    primitive:
      cameraMode ||
      ((motionMode || blendMode) && sample.primitiveKind === "camera")
        ? "camera-quad"
        : "arbitrary-quad",
    offset:
      source.SpawnShape === undefined
        ? [0, 0, 0]
        : (source.SpawnShape.emitOffset ?? [0, 0, 0]),
    bound: source.bindWeight.constantValue === 1,
    delay: source.timeBeforeFirstEmission ?? 0,
    lifetime: sourceProgram.lifetime,
    single: !!source.isSingleParticle,
    uniformScale: !!source.isUniformScale,
    angularVelocity: source.birthRotationalVelocity0?.constantValue?.map(
      Math.fround,
    ),
    emitterPosition: source.EmitterPosition?.constantValue?.map(Math.fround),
    velocity: source.birthVelocity?.constantValue?.map(Math.fround),
    inheritSystemBasis:
      source.isLocalOrientation !== 0 && source.isLocalOrientation !== false,
    materialKey: sample.shaderKey,
  });
}
if (inventoryMode) {
  const actualKeys = [...definitions.values()]
    .flatMap((definition) =>
      definition.emitters.map((emitter) => emitter.materialKey),
    )
    .sort();
  const expectedKeys = inventory.components
    .map((component) => component.shaderKey)
    .sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
    throw Error(
      "Combined load control duplicated or omitted admitted components",
    );
}
if (verifyInventory) {
  for (const path of Object.keys(inputs)) await bytes(path);
  console.log(
    JSON.stringify({
      components: seen.size,
      definitions: definitions.size,
      nativeComparisons: proofNames,
      inputFingerprintsVerified: Object.keys(inputs).length,
      visualOmittedComponentsRetained: [
        ...new Set(
          proofs
            .flatMap(({ report }) => report.visualOmissions ?? [])
            .map((row) => `${row.effectId}:${row.emitterIndex}`)
            .filter((key) => seen.has(key)),
        ),
      ],
      workersStarted: false,
      timingsMeasured: false,
    }),
  );
  process.exit(0);
}
const events = [];
const cohort = [...definitions.values()];
for (let ordinal = 0; ordinal < 1110; ordinal++) {
  const definition = cohort[ordinal % cohort.length];
  events.push({
    id: `load-control:${ordinal}`,
    kind: "create",
    origin: "animation",
    entityId: ordinal + 1,
    definitionId: definition.id,
    time: (ordinal * 30) / 1110,
    transportSequence: ordinal,
    entryOrder: 0,
    seedHex: ordinal.toString(16).padStart(16, "0"),
    placement: {
      kind: "explicit-world",
      position: [(ordinal % 21) * 250, 0, 0],
      basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      boundObjectSize: 0,
      boundObjectSizeStatus: "supplied-native-component-control-zero",
    },
  });
  events.push({
    id: `load-control-stop:${ordinal}`,
    kind: "stop",
    origin: "animation",
    entityId: ordinal + 1,
    sourceEventId: `load-control:${ordinal}`,
    time: (ordinal * 30) / 1110 + 1,
    transportSequence: ordinal,
    entryOrder: 1,
  });
}
events.sort(
  (a, b) =>
    a.time - b.time ||
    a.transportSequence - b.transportSequence ||
    a.entryOrder - b.entryOrder,
);
const scene = await read(`${assets}/latest-scene/manifest.json`);
const heightBytes = await bytes(`${assets}/latest-scene/heights.bin`);
const report = await read(`${cache}/research/latest-semantics-effects.json`);
const payload = {
  profile,
  packages,
  definitions: [...definitions.values()],
  events,
  report,
  scene,
  contract: {
    build: manifest.build,
    protocol: manifest.protocol,
    contentHash,
    replayHash: report.replaySha256,
  },
  heights: new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
  world: {},
};
const percentile = (values, fraction) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const runs = [];
const cameraFor = (angle) =>
  bendingWorld
    ? {
        right: [Math.cos(angle), 0, -Math.sin(angle)],
        up: [
          Math.sin(angle) / Math.SQRT2,
          1 / Math.SQRT2,
          Math.cos(angle) / Math.SQRT2,
        ],
        axis: [
          Math.sin(angle) / Math.SQRT2,
          -1 / Math.SQRT2,
          Math.cos(angle) / Math.SQRT2,
        ],
      }
    : {
        right: [Math.cos(angle), 0, -Math.sin(angle)],
        up: [0, 1, 0],
        axis: [Math.sin(angle), 0, Math.cos(angle)],
      };
for (const speed of [1, 4]) {
  const client = new LatestDirectEffectClient(
    bendingWorld
      ? {
          workerUrl: new URL(
            "./profile-direct-effects-worker.mjs",
            import.meta.url,
          ),
        }
      : {},
  );
  const deadline = setTimeout(() => client.close(), 60000);
  try {
    await client.initialize(payload);
    const samples = [];
    const generatedComponents = new Set();
    let peakParticles = 0,
      activeSamples = 0;
    for (let frame = 0; frame <= 1800 / speed; frame++) {
      const start = performance.now();
      const time = (frame * speed) / 60;
      const angle = cameraMode || inventoryMode ? time * 0.2 : 0;
      const camera = cameraFor(angle);
      const packet = await client.frame(time, camera);
      if (inventoryMode)
        for (const draw of packet.draws) {
          if (!seen.has(draw.materialKey))
            throw Error("Unowned combined load-control component generated");
          generatedComponents.add(draw.materialKey);
        }
      const particles = packet.draws.reduce((n, d) => n + d.particleCount, 0);
      peakParticles = Math.max(peakParticles, particles);
      activeSamples += particles > 0;
      samples.push({
        replayTime: packet.time,
        ...packet.metrics,
        effectsMs: packet.metrics.workerOperationMs,
        roundTripMs: performance.now() - start,
        particles,
      });
    }
    const checkpoint = await client.checkpoint();
    const cameraChecks = [];
    if (inventoryMode) {
      if (
        JSON.stringify([...generatedComponents].sort()) !==
        JSON.stringify([...seen].sort())
      )
        throw Error(
          "Combined load control did not generate every admitted component",
        );
      for (const angle of [0.4, 1.4]) {
        const packet = await client.camera(cameraFor(angle));
        if (
          packet.time !== checkpoint.time ||
          packet.metrics.simulationMs !== 0 ||
          packet.metrics.worldQueryMs !== 0 ||
          packet.metrics.worldQueries !== 0 ||
          packet.metrics.simulationStepsAdvanced !== 0 ||
          JSON.stringify(await client.checkpoint()) !==
            JSON.stringify(checkpoint)
        )
          throw Error("Combined camera-only redraw changed simulation state");
        cameraChecks.push({
          time: packet.time,
          particles: packet.draws.reduce(
            (sum, draw) => sum + draw.particleCount,
            0,
          ),
          metrics: packet.metrics,
        });
      }
    }
    const coverage = await client.coverage();
    if (
      checkpoint.time !== 30 ||
      checkpoint.cursor !== events.filter((event) => event.time <= 30).length ||
      coverage.decoded !== 1110 ||
      coverage.resourceResolved !== 1110 ||
      coverage.placementResolved !== 1110 ||
      coverage.worldInputsResolved !== 1110 ||
      coverage.allCompiledComponentInputsResolved !== 1110 ||
      coverage.runtimeActivated !== 1110 ||
      (inventoryMode && coverage.geometryGenerated !== 1110) ||
      coverage.rows.some((row) => {
        const definition = definitions.get(row.definitionId);
        const componentOmissions = definition.emitters
          .filter((emitter) => emitter.omissions?.length)
          .map((emitter) => ({
            index: emitter.index,
            reasons: emitter.omissions,
          }));
        const expectedReasons = [
          ...definition.systemOmissions,
          ...componentOmissions.flatMap((emitter) =>
            emitter.reasons.map(
              (reason) => `emitter:${emitter.index}:${reason}`,
            ),
          ),
        ];
        return (
          row.compiledComponentCount !== definition.emitters.length ||
          row.eligibleComponentCount !== definition.emitters.length ||
          row.initialComponentWorldInputs.length !==
            definition.emitters.length ||
          row.initialComponentWorldInputs.some(
            (component) => !component.resolved,
          ) ||
          JSON.stringify(row.reasons) !== JSON.stringify(expectedReasons) ||
          JSON.stringify(row.componentOmissions) !==
            JSON.stringify(componentOmissions) ||
          JSON.stringify(row.systemOmissions) !==
            JSON.stringify(definition.systemOmissions) ||
          JSON.stringify(row.systemFlags) !==
            JSON.stringify(definition.systemFlags) ||
          JSON.stringify(row.systemAudio) !==
            JSON.stringify(definition.systemAudio)
        );
      }) ||
      !activeSamples
    )
      throw Error("Synthetic load control omitted events or failed activation");
    const stateSha256 = await sha256(
      new TextEncoder().encode(JSON.stringify(checkpoint)),
    );
    runs.push({
      speed,
      peakParticles,
      activeSamples,
      ...(inventoryMode
        ? { generatedComponents: generatedComponents.size, cameraChecks }
        : {}),
      activation: {
        creations: coverage.decoded,
        activated: coverage.runtimeActivated,
        generated: coverage.geometryGenerated,
        orderedEventsConsumed: checkpoint.cursor,
        replayTime: checkpoint.time,
        partialSystemOmissions: coverage.rows.reduce(
          (n, row) => n + row.systemOmissions.length,
          0,
        ),
        partialComponentOmissions: coverage.rows.reduce(
          (sum, row) =>
            sum +
            row.componentOmissions.reduce(
              (n, emitter) => n + emitter.reasons.length,
              0,
            ),
          0,
        ),
      },
      stateSha256,
      samples,
      p95SimulationMs: percentile(
        samples.map((s) => s.simulationMs),
        0.95,
      ),
      p95GeometryMs: percentile(
        samples.map((s) => s.geometryMs),
        0.95,
      ),
      p95EffectsMs: percentile(
        samples.map((s) => s.effectsMs),
        0.95,
      ),
      p95RoundTripMs: percentile(
        samples.map((s) => s.roundTripMs),
        0.95,
      ),
      p95RequestDeliveryMs: percentile(
        samples.map((s) => s.transport.requestDeliveryMs),
        0.95,
      ),
      p95WorkerQueueMs: percentile(
        samples.map((s) => s.transport.workerQueueMs),
        0.95,
      ),
      p95ReplyDeliveryMs: percentile(
        samples.map((s) => s.transport.replyDeliveryMs),
        0.95,
      ),
      drawBufferBytes: samples.reduce(
        (n, s) => n + s.transport.drawBufferBytes,
        0,
      ),
      maximumDrawBufferBytes: Math.max(
        ...samples.map((s) => s.transport.drawBufferBytes),
      ),
      maximumEffectsMs: Math.max(...samples.map((s) => s.effectsMs)),
      p95WorldQueryMs: percentile(
        samples.map((s) => s.worldQueryMs),
        0.95,
      ),
      worldQueries: samples.reduce((n, s) => n + s.worldQueries, 0),
    });
  } finally {
    clearTimeout(deadline);
    client.close();
    await client.termination;
  }
}
if (runs[0].stateSha256 !== runs[1].stateSha256)
  throw Error("Load-control 1x/4x simulation states differ");
for (const path of Object.keys(inputs)) await bytes(path);
const programVersion = [...definitions.values()][0].programVersion;
const output = `${cache}/research/direct-${inventoryWithTrails ? `inventory-trails-v${programVersion}` : trailMode ? `trail-v${programVersion}` : inventoryMode ? `inventory-v${programVersion}` : groundMode ? "ground" : blendMode ? "blend" : motionMode ? "motion" : cameraMode ? "camera" : angularMode ? "angular" : loadedMode ? "loaded" : "effect"}-load-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "synthetic-native-component-load-control",
      inputs,
      components: seen.size,
      definitions: definitions.size,
      programVersion,
      componentPolicy: inventoryMode
        ? inventoryWithTrails
          ? "Every unique current request-inventory component plus explicit native-compared trail and targeted camera regressions; overlapping proofs deduplicated and zero-area components retained"
          : "Every unique currently compiled component, each backed by a current passing native comparison; overlapping proofs deduplicated and zero-area components retained"
        : "Every unique component in the passing native comparison; visual sampling omissions never remove simulation cost",
      ...(inventoryMode
        ? {
            assetGroups: [
              ...new Set(
                inventory.components.map(
                  (component) => component.effectId.split("/")[1],
                ),
              ),
            ].sort(),
            inventory,
            isolatedSourceDependencies: [...sourceDefinitions.values()].map(
              (definition) => ({
                id: definition.id,
                blockers: definition.blockers,
                unsupported: definition.unsupported,
                systemFlags: definition.systemFlags,
                systemAudio: definition.systemAudio,
                systemOmissions: definition.systemOmissions,
              }),
            ),
          }
        : {}),
      events: events.length,
      creationEvents: 1110,
      eventPolicy:
        "1110 evenly spaced synthetic creations over 30 seconds; round-robin isolated definition groups containing their verified components, ordinal seeds and explicit stops one second after creation",
      cameraPolicy:
        cameraMode || inventoryMode
          ? "supplied continuous orbit at 0.2 radians per replay second"
          : "fixed supplied camera",
      worldPolicy: bendingWorld
        ? "Tool-only supplied adapter: each creation root follows the original native trail control's explicit moving/bending path and changing basis; ordinary spectator placement gates are unchanged"
        : "Supplied stationary explicit-world roots",
      ...(worldControl
        ? {
            suppliedWorldControl: {
              nativeFrames: worldControl.nativeFrames,
              translatedQueries: worldControl.translatedQueries,
            },
          }
        : {}),
      runtime: {
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      },
      measurementContext: {
        startedAt,
        completedAt: new Date().toISOString(),
        executionContextNote,
        executionContextSource:
          "operator-supplied; not a process-monitor trace",
      },
      runs,
      scope: {
        realModuleWorker: true,
        productionSpectatorWorker: !bendingWorld,
        transportDeliveryIncludesScheduling: true,
        isolatedTransferBandwidth: false,
        syntheticEvents: true,
        recordedRequestDistribution: false,
        assetGroupsEstablishChampionOwnership: false,
        suppliedWorldInputs: true,
        wholeDefinitionAdmission: false,
        parentActivationAndPolicyIsolated: true,
        originalMatchSeedRecovered: false,
        matchCoverage: false,
        worldRendering: false,
        gpuSubmission: false,
        worldQueryMsIsSubsetOfSimulation: true,
        browserPlayback: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      output,
      components: seen.size,
      definitions: definitions.size,
      events: events.length,
      runs: runs.map(({ samples, ...row }) => row),
    },
    null,
    2,
  ),
);
