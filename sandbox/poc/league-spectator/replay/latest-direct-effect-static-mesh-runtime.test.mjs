import { expect, test } from "bun:test";
import { loadLatestDirectEffectPackage } from "./latest-direct-effect-package.mjs";
import { LatestDirectEffectRuntime } from "./latest-direct-effect-runtime.mjs";
import { directStaticMeshDrawParameters } from "./latest-direct-effect-mesh-record.mjs";
import { directStaticMeshRetainedDraw } from "./latest-direct-effect-static-mesh-draw.mjs";
import { DIRECT_STATIC_MESH_SCENE_OMISSIONS } from "./latest-direct-static-mesh-scene.mjs";

const assets = new URL(
    "../../../../.cache/replay-spike/public/",
    import.meta.url,
  ),
  load = (path) => Bun.file(new URL(path, assets)).bytes(),
  id = "champions/hecarim/0/e57b8289",
  prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [id],
  }),
  complete = prepared.definitions.get(id),
  mesh = complete.emitters.find((e) => e.index === 15);
if (!mesh || mesh.primitive !== "static-mesh" || complete.blockers.length)
  throw Error(
    "Actual prepared mesh source must be admitted without root overrides",
  );
const definition = complete,
  camera = { right: [1, 0, 0], up: [0, 1, 0] },
  basis = [1, 0, 0, 0, 1, 0, 0, 0, 1],
  normalPlacement = (_event, time) => ({
    resolved: true,
    position: [23 + time * 130, -11 + time * 3, 81 + time * 70],
    basis,
  });
function runtime(d = definition, placement = normalPlacement) {
  return new LatestDirectEffectRuntime({
    ...prepared.contract,
    replayHash: "d".repeat(64),
    definitions: new Map([[id, d]]),
    kernels: prepared.kernels,
    world: { placement },
    events: [
      {
        id: "mesh-runtime:0",
        origin: "animation",
        kind: "create",
        entityId: 1,
        definitionId: id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
        seedHex: "0000000000000001",
      },
    ],
    checkpointSeconds: 0.125,
    maximumCheckpoints: 32,
  });
}
const draws = (r) =>
  r
    .generateDraws(camera)
    .draws.filter((draw) => draw.primitive === "static-mesh");

test("actual installed mesh package produces one compact 176-byte record and independent draw data", () => {
  expect(mesh.meshMaterialSelection.status).toBe(
    "owned-static-mesh-individual-material-selection",
  );
  expect(mesh.meshProgram.resource.vertexStride).toBe(36);
  const r = runtime();
  r.advanceTo(0.25);
  const packet = draws(r);
  const row = r.coverage({ includeRows: true }).rows[0];
  for (const omission of DIRECT_STATIC_MESH_SCENE_OMISSIONS) {
    expect(mesh.omissions).toContain(omission);
    expect(row.reasons).toContain(`emitter:15:${omission}`);
  }
  expect(packet).toHaveLength(1);
  const draw = packet[0];
  expect(draw.primitive).toBe("static-mesh");
  expect(draw.particleCount).toBe(1);
  expect(draw.meshRecords).toBeInstanceOf(Uint8Array);
  expect(draw.meshRecords).toHaveLength(176);
  expect(draw.indices).toHaveLength(0);
  for (const key of ["positions", "colors", "uv", "particleUV", "vertexBytes"])
    expect(Object.hasOwn(draw, key)).toBe(false);
  const params = directStaticMeshDrawParameters({
    record: draw.meshRecords,
    resourceOffset40: mesh.meshProgram.resourceFields.offset40,
    paletteByte: 0,
    multTexturePresent: false,
  });
  expect(params.kColorFactor[0]).toBeGreaterThan(0);
  expect(Array.from(params.COLOR_LOOKUP_UV)).toEqual([0.0625, 1, 0, 0]);
  expect(params.mWorld[3]).toBe(Math.fround(23 + 0.25 * 130));
  const saved = r.checkpoint();
  draw.meshRecords.fill(0);
  expect(r.checkpoint()).toEqual(saved);
  expect(draws(r)[0].meshRecords.some((v) => v !== 0)).toBe(true);
});

test("actual mesh clocks/RNG/checkpoints match 1x/4x, camera pause and repeated seeks", () => {
  const a = runtime(),
    b = runtime();
  for (let tick = 0; tick <= 48; tick++) a.advanceTo(tick / 60);
  for (let tick = 0; tick <= 48; tick += 4) b.advanceTo(tick / 60);
  expect(a.checkpoint()).toEqual(b.checkpoint());
  a.advanceTo(0.25);
  const saved = a.checkpoint(),
    record = draws(a)[0].meshRecords.slice();
  a.generateDraws({ right: [0, 0, 1], up: [0, 1, 0] });
  expect(a.checkpoint()).toEqual(saved);
  expect(draws(a)[0].meshRecords).toEqual(record);
  for (let i = 0; i < 2; i++) {
    a.advanceTo(1.5);
    a.advanceTo(0.25);
    expect(a.checkpoint()).toEqual(saved);
    expect(draws(a)[0].meshRecords).toEqual(record);
  }
  a.advanceTo(4.1);
  expect(draws(a)).toHaveLength(0);
  a.advanceTo(0.25);
  expect(a.checkpoint()).toEqual(saved);
});

test("lost or missing required mesh basis blocks the component without a guessed transform", () => {
  const missing = runtime(definition, (_e, time) => ({
    ...normalPlacement(_e, time),
    basis: null,
  }));
  missing.advanceTo(0.2);
  expect(draws(missing)).toHaveLength(0);
  expect(missing.coverage({ includeRows: true }).rows[0].reasons).toContain(
    "emitter:15:world:component-root-basis-unresolved",
  );
  const r = runtime(definition, (_e, time) => ({
    ...normalPlacement(_e, time),
    basis: time >= 0.25 && time < 0.5 ? null : basis,
  }));
  r.advanceTo(0.2);
  expect(draws(r)).toHaveLength(1);
  r.advanceTo(0.3);
  expect(draws(r)).toHaveLength(0);
  r.advanceTo(0.6);
  expect(draws(r)).toHaveLength(0);
  r.advanceTo(0.2);
  expect(draws(r)).toHaveLength(1);
});

test("runtime rejects forged mesh resource, shader, capability and source contracts", () => {
  for (const [index, mutate] of [
    (p) => {
      delete p.meshProgram;
    },
    (p) => {
      p.meshProgram.uv.baseMatrix[0] = 1;
    },
    (p) => {
      p.meshProgram.resourcePackageSha256 = "0".repeat(64);
    },
    (p) => {
      p.meshProgram.resourceFields.offset40[0] = 1;
    },
    (p) => {
      p.meshMaterialSelection.policy.shaderPair.vertex = "0".repeat(64);
    },
    (p) => {
      p.meshMaterialSelection.policy.instanceDraw = 1;
    },
    (p) => {
      p.source.birthVelocity = {
        __type: "ValueVector3",
        constantValue: [1, 0, 0],
      };
    },
    (p) => {
      p.placementRequirements.rootBasis = false;
    },
  ].entries()) {
    const altered = structuredClone(definition);
    mutate(altered.emitters.find((p) => p.index === 15));
    let rejected = false;
    try {
      runtime(altered);
    } catch {
      rejected = true;
    }
    if (!rejected)
      throw Error(`Forged static mesh runtime contract ${index} was accepted`);
    expect(rejected).toBe(true);
  }
});

test("explicit two-particle mesh record handoff retains source pool indices in reversed draw order", () => {
  const supplied = {
    birthBasis: basis,
    birthOrigin: [0, 0, 0],
    motion: [0, 0, 0],
    rootPosition: [0, 0, 0],
    bound: true,
    rotation: [0, 0, 0],
    birthScale: [6, 3.5, 3.5],
    sampledScale: [1, 1, 1],
    birthColor: [1, 1, 1, 0.5],
    sampledColor: [1, 0, 0.015, 1],
    fraction: 0.25,
    uniformScale: true,
    systemScale: [1, 1],
    resourceFields: mesh.meshProgram.resourceFields,
    definitionColor: [1, 1, 1, 1],
    textureDivisions: [1, 1],
    blendByte: 0,
    linkedUvMatrices: [mesh.meshProgram.uv.baseMatrix, null],
  };
  const indices = [5, 2].map((particleIndex) => {
    const record = directStaticMeshRetainedDraw({
      ...supplied,
      particleIndex,
    }).record;
    return new DataView(
      record.buffer,
      record.byteOffset,
      record.byteLength,
    ).getUint32(0x5c, true);
  });
  expect(indices).toEqual([5, 2]);
  // This explicit input check does not broaden the actual single-particle source gate.
  expect(mesh.single).toBe(true);
});
