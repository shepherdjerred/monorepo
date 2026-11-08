// Actual compiler/material/worker transport and unchanged typed original source.
// The isolated emitter projection does not claim original parent activation.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import {
  LatestDirectEffectRuntime,
  directDrawTransfers,
} from "../latest-direct-effect-runtime.mjs";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { directGeometryBuffers } from "../latest-direct-effect-draw.mjs";
import { directDiagnosticDraw } from "./direct-diagnostic-draw.mjs";
import { projectDirectEmitterControl } from "./direct-emitter-control-projection.mjs";
import { normalizeDirectPointEmitter } from "../latest-direct-effect-defaults.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { DIRECT_DIAGNOSTIC_COMPILATION_MODE } from "../latest-direct-compiled-restore.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const artifactArg = process.argv.find((arg) =>
    arg.startsWith("--artifact-version="),
  ),
  artifactVersion = artifactArg
    ? Number(artifactArg.slice("--artifact-version=".length))
    : 32;
if (!Number.isSafeInteger(artifactVersion) || artifactVersion < 1)
  throw Error("Positive artifact version required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Dynamic runtime input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-mult-scale-uv-native-v32.json`,
  ),
  proof = await read(
    `${cache}/research/direct-mult-scale-uv-comparison-v32.json`,
  );
for (const p of [native, proof])
  for (const [path, hash] of Object.entries(p.inputs))
    assert.equal(await sha256(await raw(path)), hash, path);
assert.equal(proof.mismatches.length, 0);
const id = "champions/karthus/10/8ad0cea5",
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [id],
  }),
  d = prepared.definitions.get(id),
  e = d.emitters.find((e) => e.index === 6);
assert.ok(
  e?.multUvProgram,
  "Actual material-admitted unchanged dynamic MULT emitter required",
);
assert.ok(e.navGroundProgram, "Owned nav-ground program required");
const selected = native.cases.filter(
    (c) => c.variant === "unchanged" && c.multTexturePresent,
  ),
  source = selected[0].source;
assert.deepEqual(e.source, normalizeDirectPointEmitter(source));
const isolated = projectDirectEmitterControl(d, e),
  report = await read(`${cache}/research/latest-semantics-effects.json`),
  scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await load("latest-scene/heights.bin"),
  heights = new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
  contract = { ...prepared.contract, replayHash: report.replaySha256 };
const camera = {
    right: [1, 0, 0],
    up: [0, 1, 0],
    axis: [0, 0, 1],
    position: [300, 900, 1200],
  },
  alternate = {
    right: [0, 0, -1],
    up: [0, 1, 0],
    axis: [1, 0, 0],
    position: [1200, 900, 300],
  };
const counts = {
    cases: 0,
    frames: 0,
    positionLanes: 0,
    packedHalfLanes: 0,
    colorBytes: 0,
    poolLanes: 0,
    rngStates: 0,
    pauseChecks: 0,
    cameraChecks: 0,
    workerFrames: 0,
    checkpointChecks: 0,
    repeatedSeeks: 0,
    clockChecks: 0,
    textureAbsentFrames: 0,
    transferChecks: 0,
    workerMalformedRejections: 0,
    normalInitializationChecks: 0,
  },
  mismatches = [],
  initializations = [];
let maxPositionError = 0,
  maxPoolError = 0;
function numeric(a, b, context, kind) {
  const error = Math.abs(a - b);
  if (kind === "position") maxPositionError = Math.max(maxPositionError, error);
  else maxPoolError = Math.max(maxPoolError, error);
  if (!Number.isFinite(error) || error > 1e-4)
    mismatches.push({ ...context, kind, actual: a, expected: b, error });
}
function geometry(draw, expected, context) {
  const actual = draw
      ? directGeometryBuffers(draw)
      : { vertices: new Uint8Array(), indices: new Uint8Array() },
    ev = Uint8Array.fromHex(expected.verticesHex),
    ei = Uint8Array.fromHex(expected.indicesHex);
  assert.equal(actual.vertices.length, ev.length, JSON.stringify(context));
  assert.deepEqual(actual.indices, ei);
  const av = new DataView(
      actual.vertices.buffer,
      actual.vertices.byteOffset,
      actual.vertices.byteLength,
    ),
    view = new DataView(ev.buffer);
  for (let at = 0; at < ev.length; at += 28) {
    for (let lane = 0; lane < 3; lane++) {
      numeric(
        av.getFloat32(at + lane * 4, true),
        view.getFloat32(at + lane * 4, true),
        { ...context, at, lane },
        "position",
      );
      counts.positionLanes++;
    }
    for (let lane = 12; lane < 16; lane++) {
      assert.equal(av.getUint8(at + lane), view.getUint8(at + lane));
      counts.colorBytes++;
    }
    for (let lane = 16; lane < 28; lane += 2) {
      assert.equal(
        av.getUint16(at + lane, true),
        view.getUint16(at + lane, true),
        JSON.stringify({ ...context, at, lane }),
      );
      counts.packedHalfLanes++;
    }
  }
  if (draw) {
    const diagnostic = directDiagnosticDraw(draw);
    assert.equal(
      diagnostic.geometry.verticesHex,
      Buffer.from(actual.vertices).toString("hex"),
    );
    assert.deepEqual(
      diagnostic.multUV,
      draw.multUV === undefined ? undefined : [...draw.multUV],
    );
  }
}
function packetEqual(actual, expected) {
  assert.equal(actual.time, expected.time);
  assert.deepEqual(actual.draws, expected.draws);
}
const floats = (v) => new Float32Array(Uint8Array.fromHex(v.hex).buffer);
for (const c of selected) {
  const absent = native.cases.find(
      (a) =>
        a.variant === "unchanged" &&
        !a.multTexturePresent &&
        a.seedHex === c.seedHex,
    ),
    events = [
      {
        id: "dynamic-mult-control:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: c.seedHex,
        placement: {
          kind: "explicit-world",
          position: [0, 0, 0],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          boundObjectSize: 0,
          boundObjectSizeStatus: "supplied-native-component-control-zero",
        },
      },
    ],
    create = () =>
      new LatestDirectEffectRuntime({
        ...contract,
        definitions: new Map([[id, isolated]]),
        events,
        world: createLatestWorldPresentation({
          report,
          scene,
          terrain: createLatestTerrain(scene, heights),
        }),
        kernels: prepared.kernels,
      }),
    runtime = create(),
    fast = create(),
    client = new LatestDirectEffectClient();
  try {
    const payload = {
      compilationMode: DIRECT_DIAGNOSTIC_COMPILATION_MODE,
      profile: prepared.profile,
      packages: { ...prepared.packages, childSiblingDefinitions: [] },
      definitions: [isolated],
      events,
      report,
      scene,
      heights,
      contract,
      world: {},
    };
    if (counts.cases === 0) {
      const mismatch = /Serialized compiled definition differs/;
      const sourceInput = (p) =>
        p.packages.compilationInputs.find(
          ([path]) =>
            path ===
            `latest-effects/${JSON.parse(new TextDecoder().decode(prepared.packages.effectsManifest)).definitions[id].file}`,
        );
      for (const [label, mutate, pattern] of [
        [
          "missing-capture",
          (p) => delete p.packages.compilationInputs,
          /Complete captured compiler/,
        ],
        [
          "duplicate-input",
          (p) =>
            p.packages.compilationInputs.push(p.packages.compilationInputs[0]),
          /Unique complete independently owned/,
        ],
        [
          "missing-input",
          (p) =>
            p.packages.compilationInputs.splice(
              p.packages.compilationInputs.indexOf(sourceInput(p)),
              1,
            ),
          /Captured compiler input missing/,
        ],
        [
          "corrupt-source",
          (p) => (sourceInput(p)[1][0] ^= 1),
          /JSON|definition|source|hash/i,
        ],
        [
          "extra-input",
          (p) =>
            p.packages.compilationInputs.push([
              "unused.bin",
              new Uint8Array([1]),
            ]),
          /unconsumed assets/,
        ],
        [
          "aliased-input",
          (p) =>
            (p.packages.compilationInputs[1][1] =
              p.packages.compilationInputs[0][1]),
          /Unique complete independently owned/,
        ],
        [
          "missing-definition",
          (p) => (p.definitions = []),
          /inventory differs from ordered events/,
        ],
        [
          "duplicate-definition",
          (p) => p.definitions.push(p.definitions[0]),
          /inventory differs from ordered events/,
        ],
        [
          "forged-texture",
          (p) => (p.definitions[0].emitters[0].source.texture = "forged.tex"),
          mismatch,
        ],
        [
          "forged-source-blend",
          (p) => (p.definitions[0].emitters[0].source.blendMode = 0),
          mismatch,
        ],
        [
          "forged-alpha",
          (p) => (p.definitions[0].emitters[0].source.alphaRef = 0.9),
          mismatch,
        ],
        [
          "compiled-blend",
          (p) => (p.definitions[0].emitters[0].blend = 0),
          mismatch,
        ],
        [
          "compiled-uniform-scale",
          (p) =>
            (p.definitions[0].emitters[0].uniformScale =
              !p.definitions[0].emitters[0].uniformScale),
          mismatch,
        ],
        [
          "compiled-bind",
          (p) =>
            (p.definitions[0].emitters[0].bound =
              !p.definitions[0].emitters[0].bound),
          mismatch,
        ],
        [
          "compiled-local-orientation",
          (p) =>
            (p.definitions[0].emitters[0].inheritSystemBasis =
              !p.definitions[0].emitters[0].inheritSystemBasis),
          mismatch,
        ],
        [
          "compiled-placement",
          (p) =>
            (p.definitions[0].emitters[0].placementRequirements.rootBasis = false),
          mismatch,
        ],
        [
          "compiled-delay",
          (p) => (p.definitions[0].emitters[0].delay = 0.9),
          mismatch,
        ],
        [
          "wrong-pass",
          (p) => (p.definitions[0].emitters[0].navGroundProgram.passHash = 0),
          mismatch,
        ],
        [
          "wrong-shader",
          (p) =>
            (p.definitions[0].emitters[0].navGroundProgram.shaderPair.pixel =
              "0".repeat(64)),
          mismatch,
        ],
        [
          "missing-program",
          (p) => (p.definitions[0].emitters[0].navGroundProgram = null),
          mismatch,
        ],
        [
          "unsupported-metadata",
          (p) =>
            p.definitions[0].unsupported.push({
              index: 999,
              reasons: ["forged"],
            }),
          mismatch,
        ],
        [
          "blocker-metadata",
          (p) => p.definitions[0].blockers.push("forged"),
          mismatch,
        ],
        ["normal-mode-projection", (p) => delete p.compilationMode, mismatch],
      ]) {
        const forged = structuredClone(payload),
          faultClient = new LatestDirectEffectClient();
        mutate(forged);
        try {
          await assert.rejects(faultClient.initialize(forged), pattern, label);
          counts.workerMalformedRejections++;
        } finally {
          faultClient.close();
          await faultClient.termination;
        }
      }
      const normal = structuredClone(payload),
        normalClient = new LatestDirectEffectClient();
      delete normal.compilationMode;
      normal.definitions = [d];
      try {
        const initialized = await normalClient.initialize(normal);
        initializations.push({
          label: "normal-full-definition",
          compiler: initialized.compiledDefinitionValidation,
          transport: initialized.initializationTransport,
        });
        assert.equal(initialized.compiledDefinitionValidation.mode, "normal");
        counts.normalInitializationChecks++;
      } finally {
        normalClient.close();
        await normalClient.termination;
      }
    }
    const initialized = await client.initialize(payload);
    initializations.push({
      label: `diagnostic-native-seed:${c.seedHex}`,
      compiler: initialized.compiledDefinitionValidation,
      transport: initialized.initializationTransport,
    });
    assert.equal(initialized.emulatedInstructions, 0);
    assert.equal(
      initialized.compiledDefinitionValidation.mode,
      DIRECT_DIAGNOSTIC_COMPILATION_MODE,
    );
    let saved;
    for (const [tick, frame] of c.frames.entries()) {
      runtime.advanceTo(frame.input.time);
      const state = runtime.checkpoint(),
        packet = runtime.generateDraws(camera),
        draw = packet.draws[0],
        context = { tick, seed: c.seedHex };
      geometry(draw, frame.output.geometry, context);
      geometry(
        draw ? { ...draw, multUV: undefined } : null,
        absent.frames[tick].output.geometry,
        { ...context, fallback: true },
      );
      counts.textureAbsentFrames++;
      assert.deepEqual(runtime.checkpoint(), state);
      counts.pauseChecks++;
      const wp = await client.frame(frame.input.time, camera);
      packetEqual(wp, packet);
      counts.workerFrames++;
      assert.deepEqual(await client.checkpoint(), state);
      counts.checkpointChecks++;
      if (draw) {
        assert.equal(draw.multUV.length, draw.particleCount * 8);
        assert.ok(directDrawTransfers(packet).includes(draw.multUV.buffer));
        counts.transferChecks++;
      }
      const n = frame.output.state.vectors.life.count,
        pool = state.instances[0]?.[1].emitters[0];
      assert.equal(pool?.count ?? 0, n);
      if (pool) {
        const life = floats(frame.output.state.vectors.life),
          motion = floats(frame.output.state.vectors.motion),
          initial = floats(frame.output.state.vectors.initial);
        for (let i = 0; i < n; i++)
          for (const [lane, value] of [
            [0, life[i * 2]],
            [1, life[i * 2 + 1]],
            ...[0, 1, 2, 3].map((j) => [5 + j, motion[i * 9 + j]]),
            ...[0, 1, 2].map((j) => [9 + j, motion[i * 9 + 4 + j]]),
            ...[0, 1, 2].map((j) => [12 + j, initial[i * 28 + 12 + j]]),
            [18, motion[i * 9 + 8]],
          ]) {
            numeric(
              pool.data[i * 20 + lane],
              value,
              { ...context, i, lane },
              "pool",
            );
            counts.poolLanes++;
          }
        const rng = new DataView(
            Uint8Array.fromHex(frame.output.state.rngHex).buffer,
          ),
          draws = rng.getUint32(8, true);
        assert.equal(pool.random.draws, draws);
        assert.equal(
          pool.random.stateHex,
          (draws ? rng.getBigUint64(0, true) : BigInt(`0x${c.seedHex}`))
            .toString(16)
            .padStart(16, "0"),
        );
        counts.rngStates++;
      }
      if (tick === 15) {
        saved = state;
        const before = await client.checkpoint(),
          changed = await client.camera(alternate);
        packetEqual(changed, runtime.generateDraws(alternate));
        assert.equal(changed.metrics.simulationStepsAdvanced, 0);
        assert.deepEqual(await client.checkpoint(), before);
        for (const draw of changed.draws) draw.multUV?.fill(0);
        packetEqual(await client.camera(camera), runtime.generateDraws(camera));
        counts.cameraChecks += 2;
      }
      counts.frames++;
    }
    const terminal = runtime.checkpoint();
    for (let tick = 0; tick < c.frames.length; tick += 4)
      fast.advanceTo(c.frames[tick].input.time);
    fast.advanceTo(c.frames.at(-1).input.time);
    assert.deepEqual(fast.checkpoint(), terminal);
    counts.clockChecks++;
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const time of [0.1, 0.5, 4]) {
        runtime.advanceTo(time);
        packetEqual(
          await client.frame(time, camera),
          runtime.generateDraws(camera),
        );
        assert.deepEqual(await client.checkpoint(), runtime.checkpoint());
      }
      assert.deepEqual(runtime.checkpoint(), terminal);
      counts.repeatedSeeks++;
    }
    await client.restore(saved);
    runtime.restore(saved);
    packetEqual(
      await client.camera(alternate),
      runtime.generateDraws(alternate),
    );
    runtime.advanceTo(4);
    packetEqual(await client.frame(4, camera), runtime.generateDraws(camera));
    assert.deepEqual(await client.checkpoint(), terminal);
    counts.cases++;
  } finally {
    client.close();
    await client.termination;
  }
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const output = `${cache}/research/direct-mult-scale-runtime-comparison-v${artifactVersion}.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-dynamic-multiply-compiled-worker-runtime-comparison",
      artifactVersion,
      inputs,
      counts,
      maxPositionError,
      maxPoolError,
      tolerance: 1e-4,
      mismatches,
      initializations,
      scope: {
        actualCompilerOwnedMaterialAdmissionAndModuleWorker: true,
        unchangedTypedOriginalSource: true,
        exactPackedUvsColorsIndices: true,
        textureAbsentFallbackVerified: true,
        isolatedChildFreeNumericControl: true,
        gpuDrawsSubmitted: false,
        browserAcceptance: false,
        nativeMatchAcceptance: null,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    counts,
    maxPositionError,
    maxPoolError,
    mismatches: mismatches.length,
    first: mismatches.slice(0, 4),
  }),
);
if (mismatches.length) process.exitCode = 1;
