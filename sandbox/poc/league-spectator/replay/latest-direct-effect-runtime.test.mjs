import { describe, test, expect } from "bun:test";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
  directDrawTransfers,
} from "./latest-direct-effect-runtime.mjs";
import { createLatestVfxValues } from "./latest-vfx-values.mjs";
import { createLatestVfxBirth } from "./latest-vfx-birth.mjs";
import { createLatestVfxEmission } from "./latest-vfx-emission.mjs";
import {
  createLatestWorldPresentation,
  EFFECT_ENTITY_FIELDS,
  buildLatestDirectEffectEvents,
} from "./latest-world-presentation.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { normalizeDirectSystemAudio } from "./latest-direct-effect-audio.mjs";
import { compileDirectIntegratedRotation } from "./latest-direct-effect-integrated-rotation.mjs";
import {
  compileDirectQuadSprite,
  directQuadSpriteFrameHalf,
} from "./latest-direct-effect-sprite.mjs";
import { directDefaultParticlePalette } from "./latest-direct-particle-palette.mjs";
import { compileDirectMultUv } from "./latest-direct-effect-mult-uv.mjs";
import {
  createDirectCameraCache,
  directCameraBasis,
} from "./latest-direct-effect-camera.mjs";

const sliceSha256 =
  "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b";
const contentHash = "a".repeat(64),
  replayHash = "b".repeat(64);
const base = { schema: 1, build, protocol, sliceSha256 };
const values = createLatestVfxValues({
  ...base,
  float: { sampleRva: 0x16d7de0 },
  color: { sampleRva: 0x16dc340 },
  probability: { postLoadRva: 0x1786b10 },
});
const birth = createLatestVfxBirth(
  {
    ...base,
    random: {
      nextFloatRva: 0x1490eb0,
      wordRva: 0x2e7b70,
      seedRva: 0x14910e0,
      wordMultiplierHex: "2545f4914f6cdd1d",
      floatScaleBits: 0x2f800000,
    },
    point: { classHash: "ee39916f", sampleRva: 0x170acb0 },
    randomizedValues: {
      2: { sampleRva: 0x16d8d40 },
      3: { sampleRva: 0x16d9fa0 },
      4: { sampleRva: 0x16db8d0 },
    },
  },
  values,
);
const emission = createLatestVfxEmission(
  {
    ...base,
    countRva: 0x1758680,
    primitiveCapacityRva: 0x176db00,
    perUpdateCapSecondsBits: 0x3ea8f5c3,
    maximumBirthsPerUpdate: 1000,
    defaults: { periodBits: 0x7f7fffff, rate: 0, lastEmissionTime: 0 },
  },
  values,
);
const field = (constantValue, type = "ValueFloat") => ({
  __type: type,
  constantValue,
});
const source = {
  rate: field(1),
  particleLifetime: field(0.5),
  isSingleParticle: true,
  birthColor: field([0.2, 0.4, 0.8, 0.6], "ValueColor"),
  birthScale0: field([2, 3, 1], "ValueVector3"),
  birthRotation0: field([0, 0, 0], "ValueVector3"),
};
const definition = {
  programVersion: DIRECT_EFFECT_PROGRAM_VERSION,
  systemAudio: normalizeDirectSystemAudio({}),
  id: "test/effect",
  build,
  protocol,
  contentHash,
  unsupported: [],
  emitters: [
    {
      index: 0,
      placementRequirements: { rootBasis: true, boundObjectSize: null },
      source,
      primitive: "arbitrary-quad",
      basis: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      offset: [0, 0, 0],
      bound: false,
      delay: 0,
      lifetime: 1,
      single: true,
      uniformScale: false,
      materialKey: "test/0",
    },
  ],
};
const event = (overrides = {}) => ({
  id: "network:1:0",
  kind: "create",
  origin: "network-effect",
  time: 0,
  transportSequence: 1,
  entryOrder: 0,
  entityId: 1,
  definitionId: definition.id,
  seedHex: "0000000000000001",
  ...overrides,
});
const camera = { right: [1, 0, 0], up: [0, 1, 0] };
const identityBasis = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const world = {
  placement: () => ({
    resolved: true,
    position: [0, 5, 0],
    basis: identityBasis,
  }),
};
function runtime(events = [event()], d = definition, w = world) {
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash,
    replayHash,
    definitions: new Map([[d.id, d]]),
    events,
    world: w,
    kernels: { values, birth, emission },
  });
}
const geometry = (r) =>
  r.generateDraws(camera).draws.map((d) => ({
    ...d,
    positions: [...d.positions],
    uv: [...d.uv],
    colors: [...d.colors],
    indices: [...d.indices],
  }));

describe("direct effect state and replay clock", () => {
  test("arbitrary corner sums retain original center/right/up float32 order", () => {
    const s = {
        ...source,
        particleLifetime: field(Math.fround(0.3)),
        birthScale0: field([600, 0, 0], "ValueVector3"),
        birthRotation0: field([-90, -90, 0], "ValueVector3"),
        bindWeight: field(1),
        isUniformScale: true,
        scale0: {
          __type: "ValueVector3",
          dynamics: {
            __type: "VfxAnimatedVector3fVariableData",
            times: [0, Math.fround(0.2), 1],
            values: [
              [2, 0, 0],
              [1, 0, 0],
              [Math.fround(0.8), 0, 0],
            ],
          },
        },
      },
      d = {
        ...definition,
        emitters: [
          {
            ...definition.emitters[0],
            source: s,
            bound: true,
            uniformScale: true,
          },
        ],
      },
      r = runtime([event()], d, {
        placement: (_, t) => ({
          resolved: true,
          position: [
            Math.fround(t * 130),
            Math.fround(t * 3),
            Math.fround(t * 70),
          ],
          basis: identityBasis,
        }),
      });
    r.advanceTo(1 / 60);
    // Complete original Hecarim e57b8289:e3 writer frame, supplied identity
    // root and 1/60s clock. The last two X lanes distinguish regrouping.
    expect([...r.generateDraws(camera).draws[0].positions]).toEqual([
      -1031.166748046875, 0.05004516988992691, 1034.5, 1035.5,
      0.04995483160018921, 1034.5, 1035.5001220703125, 0.04995483160018921,
      -1032.166748046875, -1031.1666259765625, 0.05004516988992691,
      -1032.166748046875,
    ]);
  });
  test("overlapping multiply-scale curves retain distinct particle clocks through redraws and seeks", () => {
    const s = {
        ...source,
        rate: field(12),
        isSingleParticle: false,
        textureMult: {
          __type: "VfxTextureMultDefinitionData",
          textureMult: "test.tex",
          uvScaleMult: {
            __type: "ValueVector2",
            dynamics: {
              __type: "VfxAnimatedVector2fVariableData",
              times: [0, 1],
              values: [
                [2, 2],
                [0.5, 0.5],
              ],
            },
          },
        },
      },
      d = {
        ...definition,
        emitters: [
          {
            ...definition.emitters[0],
            source: s,
            single: false,
            multUvProgram: compileDirectMultUv(s, "arbitrary-quad"),
          },
        ],
      },
      r = runtime([event()], d),
      fast = runtime([event()], d);
    for (let tick = 0; tick <= 15; tick++) r.advanceTo(tick / 60);
    const packet = r.generateDraws(camera),
      draw = packet.draws[0],
      state = r.checkpoint(),
      distinct = new Set();
    expect(draw.particleCount).toBeGreaterThan(1);
    expect(draw.multUV.length).toBe(draw.particleCount * 8);
    for (let p = 0; p < draw.particleCount; p++)
      distinct.add([...draw.multUV.slice(p * 8, p * 8 + 8)].join(","));
    expect(distinct.size).toBeGreaterThan(1);
    const changed = r.generateDraws({ right: [0, 0, -1], up: [0, 1, 0] });
    expect(changed.draws[0].multUV).toEqual(draw.multUV);
    expect(r.checkpoint()).toEqual(state);
    structuredClone(packet, { transfer: directDrawTransfers(packet) });
    expect(draw.multUV.byteLength).toBe(0);
    expect(r.generateDraws(camera).draws[0].multUV.byteLength).toBeGreaterThan(
      0,
    );
    expect(r.checkpoint()).toEqual(state);
    for (const time of [0, 0.25, 0.5]) fast.advanceTo(time);
    r.advanceTo(0.5);
    expect(fast.checkpoint()).toEqual(r.checkpoint());
    expect(fast.generateDraws(camera).draws).toEqual(
      r.generateDraws(camera).draws,
    );
    const terminal = r.checkpoint(),
      expected = r.generateDraws(camera).draws;
    for (let repeat = 0; repeat < 2; repeat++) {
      r.advanceTo(0.1);
      r.advanceTo(0.5);
      expect(r.checkpoint()).toEqual(terminal);
      expect(r.generateDraws(camera).draws).toEqual(expected);
    }
    r.restore(state);
    r.advanceTo(0.5);
    expect(r.checkpoint()).toEqual(terminal);
    expect(r.generateDraws(camera).draws).toEqual(expected);
  });
  test("generated missile behavior diagnostics retain their origin without admitting particle activation", () => {
    const diagnostic = event({
      id: "missile-cast:1",
      origin: "missile-behavior",
      kind: "omitted",
      reasons: ["presentation:child-spawn-unimplemented"],
    });
    const r = runtime([diagnostic]);
    r.advanceTo(0);
    const row = r.coverage({ includeRows: true }).rows[0];
    expect(row.origin).toBe("missile-behavior");
    expect(row.runtimeActivated).toBe(false);
    expect(row.reasons).toEqual(diagnostic.reasons);
    for (const kind of ["create", "stop", "remove", "removal-request"])
      expect(() => runtime([{ ...diagnostic, kind }])).toThrow(
        "presentation event",
      );
  });
  test("resource presentation evidence survives creation, omission and checkpoint restore", () => {
    const presentation = {
      policy: "native-initial-resource-presentation-prefix-v1",
      nativeAcceptance: null,
      units: [
        {
          sourceEventId: "hero-creation:2:10:0",
          omissions: ["resource:native-cache-unrecovered"],
        },
      ],
    };
    const created = event({ resourceSelection: { presentation } });
    const omitted = event({
      id: "omitted:2",
      entityId: 2,
      time: 0.1,
      transportSequence: 2,
      kind: "omitted",
      reasons: ["resource:untranslated-request"],
      resourceSelection: { presentation },
    });
    const r = runtime([created, omitted]);
    r.advanceTo(0.2);
    const saved = r.checkpoint();
    expect(saved.instances[0][1].resourceEvidence).toEqual(presentation);
    expect(
      r.coverage({ includeRows: true }).rows.map((row) => row.resourceEvidence),
    ).toEqual([presentation, presentation]);
    presentation.units[0].sourceEventId = "caller-mutated";
    expect(saved.instances[0][1].resourceEvidence.units[0].sourceEventId).toBe(
      "hero-creation:2:10:0",
    );
    r.advanceTo(1);
    r.restore(saved);
    expect(r.checkpoint()).toEqual(saved);
  });
  test("a delayed multi-particle burst retains native birth clocks and spacing while following its anchor", () => {
    const burst = {
      ...definition,
      emitters: [
        {
          ...definition.emitters[0],
          bound: true,
          delay: 0.04,
          source: { ...source, rate: field(3), particleLifetime: field(0.1) },
        },
      ],
    };
    const moving = {
      placement: (_event, t) => ({
        resolved: true,
        position: [t * 130, t * 3, t * 70],
        basis: identityBasis,
      }),
    };
    const r = runtime([event()], burst, moving);
    r.advanceTo(0.05);
    const data = r.checkpoint().instances[0][1].emitters[0].data;
    // Observed original three-particle delayed burst at the same clocks.
    expect([data[0], data[20], data[40]]).toEqual([
      0.03888889029622078, 0.04444444552063942, 0.05000000074505806,
    ]);
    const centers = () => {
      const positions = geometry(r)[0].positions;
      return [0, 1, 2].map((particle) =>
        [0, 1, 2].map(
          (lane) =>
            [0, 1, 2, 3].reduce(
              (sum, vertex) =>
                sum + positions[particle * 12 + vertex * 3 + lane],
              0,
            ) / 4,
        ),
      );
    };
    const first = centers();
    expect(first[0][0]).toBeCloseTo(6.5, 5);
    expect(first[1][0]).toBeCloseTo(5.777777671813965, 5);
    expect(first[2][0]).toBeCloseTo(5.055555820465088, 5);
    r.advanceTo(4 / 60);
    const next = centers();
    expect(next[0][0] - next[1][0]).toBeCloseTo(first[0][0] - first[1][0], 5);
    expect(next[1][0] - next[2][0]).toBeCloseTo(first[1][0] - first[2][0], 5);
    r.advanceTo(0.15);
    expect(geometry(r)).toHaveLength(0);
  });
  test("constant angular motion survives repeated camera draws and seeks without consuming random values", () => {
    const spinning = {
      ...definition,
      emitters: [{ ...definition.emitters[0], angularVelocity: [12, -30, 45] }],
    };
    const animated = runtime([event()], spinning);
    const stationary = runtime();
    animated.advanceTo(0);
    const initial = geometry(animated);
    animated.advanceTo(0.2);
    stationary.advanceTo(0.2);
    const checkpoint = animated.checkpoint();
    const turned = geometry(animated);
    expect(turned[0].positions).not.toEqual(initial[0].positions);
    for (let i = 0; i < 5; i++) expect(geometry(animated)).toEqual(turned);
    expect(animated.checkpoint()).toEqual(checkpoint);
    expect(checkpoint.instances[0][1].emitters[0].random).toEqual(
      stationary.checkpoint().instances[0][1].emitters[0].random,
    );
    animated.advanceTo(0.05);
    animated.advanceTo(0.2);
    expect(geometry(animated)).toEqual(turned);
    expect(animated.checkpoint()).toEqual(checkpoint);
  });
  test("integrated camera rotation redraws and seeks without changing retained particles or RNG", () => {
    const d = structuredClone(definition);
    const rotation0 = {
      __type: "IntegratedValueVector3",
      constantValue: [1, 1, 1],
      dynamics: {
        __type: "VfxAnimatedVector3fVariableData",
        times: [0, 1],
        values: [
          [4, 0, 0],
          [4, 0, 0],
        ],
      },
    };
    d.emitters[0].primitive = "camera-quad";
    d.emitters[0].source.rotation0 = rotation0;
    d.emitters[0].source.isRotationEnabled = true;
    d.emitters[0].integratedRotation =
      compileDirectIntegratedRotation(rotation0);
    const r = runtime([event()], d);
    r.advanceTo(0);
    const first = geometry(r);
    r.advanceTo(0.2);
    const saved = r.checkpoint();
    const turned = geometry(r);
    expect(turned[0].positions).not.toEqual(first[0].positions);
    for (let i = 0; i < 3; i++) expect(geometry(r)).toEqual(turned);
    expect(r.checkpoint()).toEqual(saved);
    r.advanceTo(0.05);
    r.advanceTo(0.2);
    expect(r.checkpoint()).toEqual(saved);
    expect(geometry(r)).toEqual(turned);
    const plain = structuredClone(d);
    delete plain.emitters[0].source.rotation0;
    delete plain.emitters[0].source.isRotationEnabled;
    plain.emitters[0].integratedRotation = null;
    const control = runtime([event()], plain);
    control.advanceTo(0.2);
    expect(saved.instances[0][1].emitters).toEqual(
      control.checkpoint().instances[0][1].emitters,
    );
  });
  test("world query work is a simulation subset and camera geometry never queries poses", () => {
    let queries = 0;
    const r = runtime([event()], definition, {
      placement: () => {
        queries++;
        return world.placement();
      },
    });
    r.advanceTo(0.05);
    expect(r.metrics.worldQueries).toBe(queries);
    expect(queries).toBeGreaterThan(0);
    expect(r.metrics.worldQueryMs).toBeGreaterThanOrEqual(0);
    expect(r.metrics.worldQueryMs).toBeLessThanOrEqual(r.metrics.simulationMs);
    const before = queries;
    geometry(r);
    geometry(r);
    expect(queries).toBe(before);
    r.advanceTo(0.05);
    expect(r.metrics.worldQueries).toBe(0);
    expect(r.metrics.worldQueryMs).toBe(0);
  });
  test("simultaneous adjacent deaths preserve the native pool survivor order", () => {
    const d = structuredClone(definition);
    d.emitters[0].source.rate = field(4);
    d.emitters[0].source.particleLifetime = field(1);
    const r = runtime([event()], d);
    r.advanceTo(0);
    const saved = r.checkpoint();
    const e = saved.instances[0][1].emitters[0];
    expect(e.count).toBe(4);
    for (let i = 0; i < 4; i++) {
      e.data[i * 20] = i / 1000;
      e.data[i * 20 + 1] = i < 2 ? 0.1 : 1;
    }
    r.restore(saved);
    r.advanceTo(0.2);
    const after = r.checkpoint().instances[0][1].emitters[0];
    expect(after.count).toBe(2);
    expect([after.data[0], after.data[20]]).toEqual([
      Math.fround(0.003),
      Math.fround(0.002),
    ]);
  });
  test("camera quads quantize signed rotations and redraw without changing simulation or seeks", () => {
    const d = structuredClone(definition);
    d.emitters[0].primitive = "camera-quad";
    d.emitters[0].source.birthRotation0 = field(
      [90.75, 41, 270],
      "ValueVector3",
    );
    const r = runtime([event()], d);
    r.advanceTo(0.25);
    const saved = r.checkpoint();
    const first = geometry(r);
    expect(r.generateDraws(camera).metrics.cameraCacheBuilds).toBe(0);
    const turned = r.generateDraws({ right: [0, 0, -1], up: [0, 1, 0] });
    expect(turned.metrics.cameraCacheBuilds).toBe(1);
    expect([...turned.draws[0].positions]).not.toEqual(first[0].positions);
    expect(r.checkpoint()).toEqual(saved);
    expect(geometry(r)).toEqual(first);
    r.advanceTo(0.4);
    r.advanceTo(0.1);
    r.advanceTo(0.25);
    expect(geometry(r)).toEqual(first);
    const cache = createDirectCameraCache(camera);
    expect(directCameraBasis(cache, 90.99)).toEqual(
      directCameraBasis(cache, 90),
    );
    expect(directCameraBasis(cache, -90.99)).toEqual(
      directCameraBasis(cache, 270),
    );
    expect(directCameraBasis(cache, 2147483648)).toEqual(
      directCameraBasis(cache, -2147483648),
    );
    expect(() =>
      createDirectCameraCache({ right: [2, 0, 0], up: [0, 1, 0] }),
    ).toThrow("unit orthogonal");
  });
  test("quad geometry agrees with the native format0/count1 observation", () => {
    const r = runtime();
    r.advanceTo(0);
    const [draw] = geometry(r);
    expect(draw.positions).toEqual([2, 2, 0, 2, 8, 0, -2, 8, 0, -2, 2, 0]);
    expect(draw.uv).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(draw.indices).toEqual([0, 1, 2, 0, 2, 3]);
    expect(r.coverage()).toMatchObject({
      runtimeActivated: 1,
      geometryGenerated: 1,
      componentsRendered: null,
      complete: null,
    });
    expect(r.checkpoint().instances[0][1].emitters[0].random.draws).toBe(1);
  });
  test("1x and 4x schedules, repeated seeks and paused redraws retain identical state", () => {
    const a = runtime(),
      b = runtime();
    for (let frame = 0; frame <= 24; frame++) a.advanceTo(frame / 60);
    for (let frame = 0; frame <= 6; frame++) b.advanceTo((frame * 4) / 60);
    expect(a.checkpoint()).toEqual(b.checkpoint());
    const before = a.checkpoint(),
      output = geometry(a);
    geometry(a);
    a.generateDraws({ right: [0, 0, 1], up: [0, 1, 0] });
    expect(a.checkpoint()).toEqual(before);
    a.advanceTo(0.1);
    a.advanceTo(0.4);
    expect(geometry(a)).toEqual(output);
    a.advanceTo(0.1);
    a.advanceTo(0.4);
    expect(geometry(a)).toEqual(output);
  });
  test("random birth values and retained particle chances survive speed changes and seeking", () => {
    const varied = structuredClone(definition);
    varied.emitters[0].single = false;
    varied.emitters[0].source.rate = field(12);
    varied.emitters[0].source.isSingleParticle = false;
    varied.emitters[0].source.birthScale0 = {
      __type: "ValueVector3",
      dynamics: {
        __type: "VfxAnimatedVector3fVariableData",
        times: [0],
        values: [[2, 3, 1]],
        probabilityTables: [{ keyTimes: [0, 1], keyValues: [0.5, 1] }, {}, {}],
      },
    };
    const a = runtime([event()], varied),
      b = runtime([event()], varied);
    for (let frame = 0; frame <= 60; frame++) a.advanceTo(frame / 60);
    for (let frame = 0; frame <= 15; frame++) b.advanceTo((frame * 4) / 60);
    expect(a.checkpoint()).toEqual(b.checkpoint());
    const saved = a.checkpoint();
    const output = geometry(a);
    const emitter = saved.instances[0][1].emitters[0];
    expect(emitter.random.draws).toBeGreaterThan(2);
    expect(emitter.data[18]).toBeGreaterThan(0);
    a.advanceTo(0.1);
    a.advanceTo(1);
    expect(a.checkpoint()).toEqual(saved);
    expect(geometry(a)).toEqual(output);
  });
  test("same-time reuse/removal preserves transport order and generations", () => {
    const r = runtime([
      event(),
      event({ kind: "stop", id: "stop", transportSequence: 2 }),
      event({ id: "network:1:1", transportSequence: 3 }),
      event({
        id: "omitted",
        kind: "omitted",
        time: 0.2,
        transportSequence: 4,
        reasons: ["resource:missing"],
      }),
    ]);
    r.advanceTo(0);
    expect(geometry(r)[0].sourceEventId).toBe("network:1:1");
    expect(geometry(r)[0].generation).toBe(2);
    r.advanceTo(0.2);
    expect(geometry(r)).toEqual([]);
    expect(r.coverage({ includeRows: true }).rows.at(-1).generation).toBe(3);
  });
  test("delayed birth, emission stopping and tails retire at lifetime", () => {
    const d = structuredClone(definition);
    d.emitters[0].delay = 0.1;
    const r = runtime(
      [
        event(),
        event({ kind: "stop", id: "stop", time: 0.2, transportSequence: 2 }),
      ],
      d,
    );
    r.advanceTo(0.05);
    expect(geometry(r)).toHaveLength(0);
    r.advanceTo(0.15);
    expect(geometry(r)).toHaveLength(1);
    r.advanceTo(0.3);
    expect(geometry(r)).toHaveLength(1);
    r.advanceTo(0.7);
    expect(geometry(r)).toHaveLength(0);
    expect(r.instances.size).toBe(0);
  });
  test("the exact native lifetime boundary still renders before retirement", () => {
    const r = runtime();
    r.advanceTo(0.5);
    expect(geometry(r)).toHaveLength(1);
    r.advanceTo(31 / 60);
    expect(geometry(r)).toHaveLength(0);
  });
  test("continuous emission never changes with display frequency or camera", () => {
    const d = structuredClone(definition);
    d.emitters[0].source.rate = field(60);
    d.emitters[0].single = false;
    d.emitters[0].source.isSingleParticle = false;
    const a = runtime([event()], d),
      b = runtime([event()], d);
    for (let i = 0; i <= 24; i++) {
      a.advanceTo(i / 60);
      geometry(a);
    }
    b.advanceTo(0.4);
    expect(geometry(a)).toEqual(geometry(b));
    expect(a.checkpoint()).toEqual(b.checkpoint());
  });
  test("network removal flags are retained without inventing stop/retirement semantics", () => {
    const r = runtime([
      event(),
      event({
        kind: "removal-request",
        id: "removal",
        time: 0.1,
        transportSequence: 2,
        sourceEventId: "network:1:0",
        requestedFlags: 0x800,
      }),
    ]);
    r.advanceTo(0.2);
    expect(geometry(r)).toHaveLength(1);
    expect(r.coverage({ includeRows: true }).rows[0]).toMatchObject({
      removalRequests: ["removal"],
      requestedFlags: 0x800,
      reasons: ["lifecycle:untranslated-removal-flags:2048"],
    });
  });
  test("omitted request reasons retain mutable ledger ownership through linked removal", () => {
    const omitted = event({ kind: "omitted", reasons: ["resource:missing"] }),
      r = runtime([
        omitted,
        event({
          kind: "removal-request",
          id: "removal",
          time: 0.1,
          transportSequence: 2,
          sourceEventId: omitted.id,
          requestedFlags: 0x800,
        }),
      ]);
    r.advanceTo(0.2);
    expect(r.coverage({ includeRows: true }).rows[0].reasons).toEqual([
      "resource:missing",
      "lifecycle:untranslated-removal-flags:2048",
    ]);
    expect(omitted.reasons).toEqual(["resource:missing"]);
    const saved = r.checkpoint();
    r.advanceTo(0.01);
    r.advanceTo(0.2);
    expect(r.checkpoint()).toEqual(saved);
  });
  test("create inputs sharing omitted lifecycle graphs retain aliases through restore", () => {
    const reasons = ["resource:missing"],
      sharedMetadata = { nested: { marker: 1 } },
      created = event({ reasons, sharedMetadata }),
      omitted = event({
        id: "omitted-shared",
        entityId: 2,
        kind: "omitted",
        time: 0.01,
        transportSequence: 2,
        reasons,
        sharedMetadata,
      }),
      removal = (id, time, sequence, requestedFlags) =>
        event({
          kind: "removal-request",
          id,
          entityId: 2,
          time,
          transportSequence: sequence,
          sourceEventId: omitted.id,
          requestedFlags,
        }),
      r = runtime([
        created,
        omitted,
        removal("removal-shared", 0.1, 3, 0x800),
        removal("removal-restored", 0.3, 4, 0x400),
      ]);
    expect(r.events[0].reasons).toBe(r.events[1].reasons);
    expect(r.events[0].sharedMetadata).toBe(r.events[1].sharedMetadata);
    expect(Object.isFrozen(r.events[0])).toBe(false);
    r.events[1].sharedMetadata.nested.marker = 2;
    expect(r.events[0].sharedMetadata.nested.marker).toBe(2);
    r.advanceTo(0.2);
    expect(r.instances.get("network-effect:1").event.reasons).toContain(
      "lifecycle:untranslated-removal-flags:2048",
    );
    const saved = r.checkpoint();
    r.restore(saved);
    r.advanceTo(0.4);
    expect(r.instances.get("network-effect:1").event.reasons).toContain(
      "lifecycle:untranslated-removal-flags:1024",
    );
    expect(
      r
        .coverage({ includeRows: true })
        .rows.find((row) => row.id === omitted.id).reasons,
    ).toEqual(r.instances.get("network-effect:1").event.reasons);
    expect(reasons).toEqual(["resource:missing"]);
    expect(sharedMetadata.nested.marker).toBe(1);
  });
  test("bound particles follow placement without rebirthing or camera replay", () => {
    const d = structuredClone(definition);
    d.emitters[0].bound = true;
    const r = runtime([event()], d, {
      placement: (_, t) => ({
        resolved: true,
        position: [t * 60, 5, 0],
        basis: identityBasis,
      }),
    });
    r.advanceTo(0.2);
    expect(geometry(r)[0].positions[0]).toBe(14);
    expect(r.checkpoint().instances[0][1].emitters[0].random.draws).toBe(1);
  });
  test("unresolved world references block instances, not just individual components", () => {
    const r = runtime([event()], definition, {
      placement: () => ({ resolved: false, reasons: ["world:missing-bone:7"] }),
    });
    r.advanceTo(0.2);
    expect(geometry(r)).toEqual([]);
    expect(r.coverage({ includeRows: true }).rows[0]).toMatchObject({
      worldInputsResolved: false,
      runtimeActivated: false,
      reasons: [
        "world:missing-bone:7",
        "emitter:0:world:instance-placement-unresolved",
      ],
    });
  });
  test("compact draw transfers cannot detach simulation/checkpoint storage", () => {
    const r = runtime();
    r.advanceTo(0.2);
    const before = r.checkpoint(),
      packet = r.generateDraws(camera);
    const transferred = structuredClone(packet, {
      transfer: directDrawTransfers(packet),
    });
    expect(transferred.draws[0].positions.length).toBe(12);
    expect(packet.draws[0].particleUV.byteLength).toBe(0);
    expect(transferred.draws[0].particleUV.length).toBe(3);
    expect(r.checkpoint()).toEqual(before);
    expect(geometry(r)).toHaveLength(1);
  });
  test("transfers only live geometry between simulation ticks", () => {
    const varied = structuredClone(definition);
    varied.emitters[0].source.rate = field(2);
    varied.emitters[0].source.isRandomStartFrame = true;
    varied.emitters[0].source.numFrames = 4;
    varied.emitters[0].spriteProgram = compileDirectQuadSprite(
      varied.emitters[0].source,
      "arbitrary-quad",
    );
    varied.emitters[0].source.particleLifetime = {
      __type: "ValueFloat",
      dynamics: {
        __type: "VfxAnimatedFloatVariableData",
        times: [0],
        values: [0.5],
        probabilityTables: [{ keyTimes: [0, 1], keyValues: [0.5, 1] }],
      },
    };
    const r = runtime([event()], varied);
    r.advanceTo(0);
    const emitter = r.checkpoint().instances[0][1].emitters[0];
    expect(emitter.count).toBe(2);
    const firstExpiry = Math.min(emitter.data[1], emitter.data[21]);
    const nextBoundary = Math.min(
      Math.ceil(firstExpiry * 60) / 60,
      Math.max(emitter.data[1], emitter.data[21]),
    );
    r.advanceTo((firstExpiry + nextBoundary) / 2);
    const packet = r.generateDraws(camera);
    expect(packet.draws[0].particleCount).toBe(1);
    const alive = [0, 1].filter(
      (index) =>
        Math.fround(Math.fround(r.time) - emitter.data[index * 20]) <=
        emitter.data[index * 20 + 1],
    );
    expect(alive).toHaveLength(1);
    const at = alive[0] * 20,
      age = Math.fround(Math.fround(r.time) - emitter.data[at]),
      fraction = Math.fround(age / emitter.data[at + 1]);
    expect([...packet.draws[0].particleUV]).toEqual([
      directQuadSpriteFrameHalf(
        varied.emitters[0].spriteProgram,
        emitter.data[at + 18],
      ),
      ...directDefaultParticlePalette(fraction),
    ]);
    const logicalBytes = packet.draws
      .flatMap((draw) => [
        draw.positions,
        draw.colors,
        draw.uv,
        draw.particleUV,
        draw.indices,
      ])
      .reduce((n, view) => n + view.byteLength, 0);
    expect(packet.metrics.transferredBytes).toBe(logicalBytes);
    expect(packet.metrics.transferredBytes).toBe(
      directDrawTransfers(packet).reduce(
        (n, buffer) => n + buffer.byteLength,
        0,
      ),
    );
    const before = r.checkpoint();
    const transferred = structuredClone(packet, {
      transfer: directDrawTransfers(packet),
    });
    expect(transferred.draws[0].particleCount).toBe(1);
    expect(r.checkpoint()).toEqual(before);
    expect(r.generateDraws(camera).draws).toEqual(transferred.draws);
  });
  test("automatic checkpoints retain historical removal changes and independent generations", () => {
    const ordered = [
      event(),
      event({
        id: "network:2:0",
        kind: "removal-request",
        sourceEventId: "network:1:0",
        requestedFlags: 0x800,
        time: 4.25,
        transportSequence: 2,
      }),
      event({ id: "network:3:0", time: 4.3, transportSequence: 3 }),
      event({
        id: "network:4:0",
        kind: "omitted",
        entityId: 2,
        reasons: ["control:unresolved-resource"],
        time: 6.25,
        transportSequence: 4,
      }),
      event({
        id: "network:5:0",
        entityId: 2,
        time: 6.5,
        transportSequence: 5,
      }),
    ];
    const r = runtime(ordered);
    r.advanceTo(8.1);
    const exposed = r.checkpoint();
    exposed.ledger[0][1].reasons.push("caller mutation");
    exposed.ledger[0][1].removalRequests.push("caller mutation");
    // Each seek crosses the same private checkpoint cadence as ordinary Play.
    // The removal request targets a retired historical row, whose cached copy
    // must change only in checkpoints after that ordered event.
    for (const time of [6, 4.1, 6.3, 8.1, 2.2, 4.5, 8.1, 0, 8.1]) {
      r.advanceTo(time);
      const fresh = runtime(ordered);
      fresh.advanceTo(time);
      expect(r.checkpoint()).toEqual(fresh.checkpoint());
    }
    const rows = r.coverage({ includeRows: true }).rows;
    expect(rows[0].removalRequests).toEqual(["network:2:0"]);
    expect(rows[0].requestedFlags).toBe(0x800);
    expect(rows.find((row) => row.id === "network:3:0").generation).toBe(2);
    expect(rows.find((row) => row.id === "network:5:0").generation).toBe(2);
    expect(r).not.toHaveProperty("checkpoints");
    expect(r).not.toHaveProperty("initial");
  });
  test("automatic checkpoints refresh active pose evidence and subsequent input loss", () => {
    const long = structuredClone(definition);
    long.emitters[0].source.particleLifetime = field(5);
    for (const lossAt of [Infinity, 3]) {
      const dynamicWorld = {
        presentationContentHash: "c".repeat(64),
        placement: (_event, time) =>
          time >= lossAt
            ? { resolved: false, reasons: ["world:control-input-loss"] }
            : {
                ...world.placement(),
                position: [time, 0, 0],
                poseEvidence: {
                  presentationContentHash: "c".repeat(64),
                  time,
                  nativeAcceptance: null,
                  nativePoseParity: null,
                },
              },
      };
      const r = runtime([event()], long, dynamicWorld);
      r.advanceTo(4.1);
      for (const time of [4, 2.1, 4.1, 2.2, 4.1]) {
        r.advanceTo(time);
        const fresh = runtime([event()], long, dynamicWorld);
        fresh.advanceTo(time);
        expect(r.checkpoint()).toEqual(fresh.checkpoint());
      }
      expect(
        r
          .coverage({ includeRows: true })
          .rows[0].reasons.includes("world:control-input-loss"),
      ).toBe(lossAt !== Infinity);
    }
  });
  test("rejects incompatible packages, foreign replays, duplicate and reordered events", () => {
    expect(() => runtime([event(), event()])).toThrow("duplicate");
    expect(() =>
      runtime([event({ time: 1 }), event({ id: "second", time: 0 })]),
    ).toThrow("unordered");
    const r = runtime(),
      state = r.checkpoint();
    state.contract.replayHash = "c".repeat(64);
    expect(() => r.restore(state)).toThrow("Incompatible");
    expect(() =>
      runtime([], { ...definition, contentHash: "c".repeat(64) }),
    ).toThrow("Incompatible");
  });
  test("rejects stale compiled programs independently of matching asset hashes", () => {
    for (const programVersion of [
      undefined,
      null,
      DIRECT_EFFECT_PROGRAM_VERSION - 1,
      DIRECT_EFFECT_PROGRAM_VERSION + 1,
      String(DIRECT_EFFECT_PROGRAM_VERSION),
      NaN,
    ])
      expect(() => runtime([], { ...definition, programVersion })).toThrow(
        "Incompatible compiled effect definition",
      );
    expect(runtime([]).contract.runtimeVersion).toBe(
      DIRECT_EFFECT_PROGRAM_VERSION,
    );
    const current = runtime([]);
    const stale = current.checkpoint();
    stale.contract.runtimeVersion = DIRECT_EFFECT_PROGRAM_VERSION - 1;
    expect(() => current.restore(stale)).toThrow(
      "Incompatible direct effect checkpoint",
    );
  });
  test("checkpoints bind the exact static world presentation content", () => {
    const supplied = (hash) => ({ ...world, presentationContentHash: hash });
    const first = runtime([event()], definition, supplied("c".repeat(64)));
    first.advanceTo(0.05);
    const saved = first.checkpoint();
    expect(saved.contract.worldPresentationContentHash).toBe("c".repeat(64));
    const same = runtime([event()], definition, supplied("c".repeat(64)));
    same.restore(saved);
    expect(same.checkpoint()).toEqual(saved);
    expect(geometry(same)).toEqual(geometry(first));
    for (const hash of [null, "d".repeat(64)]) {
      const other = runtime([event()], definition, supplied(hash));
      expect(() => other.restore(saved)).toThrow(
        "Incompatible direct effect checkpoint",
      );
      expect(() => first.restore(other.checkpoint())).toThrow(
        "Incompatible direct effect checkpoint",
      );
    }
    for (const hash of [
      "",
      "C".repeat(64),
      "c".repeat(63),
      1,
      { toString: () => "c".repeat(64) },
    ])
      expect(() => runtime([], definition, supplied(hash))).toThrow(
        "Invalid direct effect runtime contract",
      );
    const mutableWorld = supplied("c".repeat(64));
    const changed = runtime([event()], definition, mutableWorld);
    const initial = changed.checkpoint();
    mutableWorld.presentationContentHash = "d".repeat(64);
    for (const action of [
      () => changed.advanceTo(0.05),
      () => changed.generateDraws(camera),
      () => changed.restore(initial),
      () => changed.checkpoint(),
    ])
      expect(action).toThrow("World presentation content changed");
  });
  test("pose evidence is retained independently in creation and checkpoint state", () => {
    const poseEvidence = {
      policy: "same-viewer-actor-pose-v1",
      presentationContentHash: "c".repeat(64),
      source: { entityId: 7, key: 42 },
      nativeAcceptance: null,
      nativePoseParity: null,
    };
    const r = runtime([event()], definition, {
      ...world,
      presentationContentHash: "c".repeat(64),
      placement: () => ({ ...world.placement(), poseEvidence }),
    });
    r.advanceTo(0.05);
    const saved = r.checkpoint();
    expect(saved.instances[0][1].placementEvidence.poseEvidence).toEqual(
      poseEvidence,
    );
    expect(
      r.coverage({ includeRows: true }).rows[0].placementEvidence.poseEvidence,
    ).toEqual(poseEvidence);
    poseEvidence.source.key = 43;
    expect(
      saved.instances[0][1].placementEvidence.poseEvidence.source.key,
    ).toBe(42);
    expect(
      r.coverage({ includeRows: true }).rows[0].placementEvidence.poseEvidence
        .source.key,
    ).toBe(42);
    r.restore(saved);
    expect(r.checkpoint()).toEqual(saved);
    for (const collection of ["ledger", "instances"])
      for (const field of ["placementEvidence", "lastResolvedPoseEvidence"])
        for (const corruption of [
          { presentationContentHash: "d".repeat(64) },
          { nativeAcceptance: true },
          { nativePoseParity: true },
        ]) {
          const invalid = structuredClone(saved);
          const target = invalid[collection][0][1];
          Object.assign(
            field === "placementEvidence"
              ? target[field].poseEvidence
              : target[field],
            corruption,
          );
          expect(() => r.restore(invalid)).toThrow(
            "Pose evidence requires matching static presentation content",
          );
          expect(r.checkpoint()).toEqual(saved);
        }
  });
  test("latest sampled pose evidence follows the anchor while creation evidence stays fixed", () => {
    const digest = "c".repeat(64);
    const r = runtime([event()], definition, {
      ...world,
      presentationContentHash: digest,
      placement: (_event, time) => ({
        ...world.placement(),
        poseEvidence: {
          presentationContentHash: digest,
          time,
          nativeAcceptance: null,
          nativePoseParity: null,
        },
      }),
    });
    r.advanceTo(0.2);
    const row = r.coverage({ includeRows: true }).rows[0];
    expect(row.placementEvidence.poseEvidence.time).toBe(0);
    expect(row.lastResolvedPoseEvidence.time).toBeGreaterThan(0);
    expect(r.checkpoint().instances[0][1].lastResolvedPoseEvidence).toEqual(
      row.lastResolvedPoseEvidence,
    );
    const originalTime = row.lastResolvedPoseEvidence.time;
    row.lastResolvedPoseEvidence.time = 99;
    expect(r.checkpoint().instances[0][1].lastResolvedPoseEvidence.time).toBe(
      originalTime,
    );
    expect(
      r.coverage({ includeRows: true }).rows[0].lastResolvedPoseEvidence.time,
    ).toBe(originalTime);
    for (const evidence of [
      {
        presentationContentHash: "d".repeat(64),
        nativeAcceptance: null,
        nativePoseParity: null,
      },
      {
        presentationContentHash: digest,
        nativeAcceptance: true,
        nativePoseParity: null,
      },
      { presentationContentHash: digest, nativeAcceptance: null },
      [],
    ])
      expect(() =>
        runtime([event()], definition, {
          ...world,
          presentationContentHash: digest,
          placement: () => ({ ...world.placement(), poseEvidence: evidence }),
        }).advanceTo(0),
      ).toThrow("Pose evidence requires matching static presentation content");
  });
});

describe("component world-input dependencies", () => {
  test("verified nonzero Flex follows current size without rebirth and restores through seeks", () => {
    const d = structuredClone(definition);
    d.emitters[0].source.FlexShapeDefinition = {
      __type: "VfxFlexShapeDefinitionData",
      scaleBirthScaleByBoundObjectSize: Math.fround(0.005),
    };
    d.emitters[0].placementRequirements.boundObjectSize = "finite-nonnegative";
    let queries = 0;
    const w = {
      placement: (_event, time) => {
        queries++;
        return {
          ...world.placement(),
          boundObjectSize: time < 0.1 ? 100 : 400,
        };
      },
    };
    const r = runtime([event()], d, w),
      reference = runtime([event()]);
    const width = (draw) =>
      Math.max(...draw.positions.filter((_, i) => i % 3 === 0)) -
      Math.min(...draw.positions.filter((_, i) => i % 3 === 0));
    r.advanceTo(0.05);
    reference.advanceTo(0.05);
    expect(width(geometry(r)[0])).toBeCloseTo(
      width(geometry(reference)[0]) * 0.5,
      6,
    );
    const saved = r.checkpoint(),
      retained = saved.instances[0][1].emitters[0];
    r.advanceTo(0.15);
    const later = geometry(r),
      laterState = r.checkpoint(),
      beforeDraws = queries;
    geometry(r);
    geometry(r);
    expect(queries).toBe(beforeDraws);
    expect(laterState.instances[0][1].emitters[0].random).toEqual(
      retained.random,
    );
    expect(laterState.instances[0][1].emitters[0].data).toEqual(retained.data);
    expect(laterState.instances[0][1].emitters[0].boundScale).toBe(
      1.1666667461395264,
    );
    r.restore(saved);
    r.advanceTo(0.15);
    expect(geometry(r)).toEqual(later);
  });
  const constrained = () => ({
    ...structuredClone(definition),
    emitters: [
      {
        ...structuredClone(definition.emitters[0]),
        placementRequirements: { rootBasis: true, boundObjectSize: 0 },
      },
      { ...structuredClone(definition.emitters[0]), index: 1 },
    ],
  });
  const supplied = (boundObjectSize) => ({
    placement: () => ({
      ...world.placement(),
      boundObjectSize,
      boundObjectSizeStatus: "supplied-native-default-control",
    }),
  });
  test("placement alone cannot pass the component input stage", () => {
    const noBasis = {
      placement: () => ({ resolved: true, position: [0, 5, 0] }),
    };
    for (const d of [definition, { ...definition, emitters: [] }]) {
      const r = runtime([event()], d, noBasis);
      r.advanceTo(0.05);
      const coverage = r.coverage({ includeRows: true });
      expect(coverage).toMatchObject({
        resourceResolved: 1,
        placementResolved: 1,
        worldInputsResolved: 0,
        allCompiledComponentInputsResolved: 0,
        runtimeActivated: 0,
      });
      expect(coverage.rows[0]).toMatchObject({
        placementResolved: true,
        worldInputsResolved: false,
        allCompiledComponentInputsResolved: false,
        compiledComponentCount: d.emitters.length,
        eligibleComponentCount: 0,
      });
    }
  });
  test("unknown and nonzero bound size omit only dependent components", () => {
    for (const size of [undefined, null, 3]) {
      const r = runtime([event()], constrained(), supplied(size));
      r.advanceTo(0.05);
      expect(geometry(r).map((draw) => draw.emitterId)).toEqual([1]);
      const row = r.coverage({ includeRows: true }).rows[0];
      expect(row.runtimeActivated).toBe(true);
      expect(row).toMatchObject({
        placementResolved: true,
        worldInputsResolved: true,
        allCompiledComponentInputsResolved: false,
        compiledComponentCount: 2,
        eligibleComponentCount: 1,
      });
      expect(row.componentWorldInputs.map((c) => c.resolved)).toEqual([
        false,
        true,
      ]);
      expect(row.componentOmissions[0].reasons).toContain(
        size == null
          ? "world:component-bound-object-size-unresolved"
          : "world:component-nonzero-bound-object-size-untranslated",
      );
    }
  });
  test("an explicit original zero admits constrained components and retains evidence", () => {
    const r = runtime([event()], constrained(), supplied(0));
    r.advanceTo(0.05);
    expect(geometry(r).map((draw) => draw.emitterId)).toEqual([0, 1]);
    const saved = r.checkpoint();
    expect(r.coverage()).toMatchObject({
      placementResolved: 1,
      worldInputsResolved: 1,
      allCompiledComponentInputsResolved: 1,
    });
    expect(saved.instances[0][1].placementEvidence).toMatchObject({
      boundObjectSize: 0,
      boundObjectSizeStatus: "supplied-native-default-control",
    });
    r.advanceTo(0.2);
    r.restore(saved);
    expect(r.checkpoint()).toEqual(saved);
  });
  test("basis-dependent components cannot inherit a guessed identity", () => {
    const unknownBasis = {
      placement: () => ({ resolved: true, position: [0, 5, 0] }),
    };
    const blocked = runtime([event()], definition, unknownBasis);
    blocked.advanceTo(0.05);
    expect(geometry(blocked)).toEqual([]);
    expect(
      blocked.coverage({ includeRows: true }).rows[0].componentOmissions,
    ).toEqual([
      { index: 0, reasons: ["world:component-root-basis-unresolved"] },
    ]);
    const independent = structuredClone(definition);
    independent.emitters[0].primitive = "camera-quad";
    independent.emitters[0].placementRequirements.rootBasis = false;
    const partial = runtime([event()], independent, unknownBasis);
    partial.advanceTo(0.05);
    expect(geometry(partial)).toHaveLength(1);
    expect(
      partial.coverage({ includeRows: true }).rows[0].placementEvidence
        .basisStatus,
    ).toBeUndefined();
  });
  test("losing an input blocks its component until replay and survives checkpoints", () => {
    const changing = {
      placement: (_event, t) => ({
        ...world.placement(),
        boundObjectSize: t >= 0.1 && t < 0.18 ? undefined : 0,
      }),
    };
    const r = runtime([event()], constrained(), changing);
    r.advanceTo(0.05);
    const before = r.checkpoint();
    expect(geometry(r)).toHaveLength(2);
    r.advanceTo(0.2);
    expect(geometry(r).map((draw) => draw.emitterId)).toEqual([1]);
    const lost = r.checkpoint();
    const lostRow = r.coverage({ includeRows: true }).rows[0];
    expect(lostRow.initialComponentWorldInputs.map((c) => c.resolved)).toEqual([
      true,
      true,
    ]);
    expect(lostRow.componentWorldInputs.map((c) => c.resolved)).toEqual([
      false,
      true,
    ]);
    expect(lostRow.allCompiledComponentInputsResolved).toBe(true);
    expect(r.coverage().allCompiledComponentInputsResolved).toBe(1);
    expect(lost.instances[0][1].emitters[0].worldInputLost).toBe(true);
    expect(lost.ledger[0][1].componentOmissions[0].reasons).toContain(
      "world:component-input-loss-requires-replay",
    );
    r.restore(lost);
    expect(geometry(r).map((draw) => draw.emitterId)).toEqual([1]);
    r.restore(before);
    r.advanceTo(0.08);
    expect(geometry(r)).toHaveLength(2);
    r.advanceTo(0.2);
    expect(geometry(r).map((draw) => draw.emitterId)).toEqual([1]);
  });
  test("base placement loss cannot resume across an unknown motion interval", () => {
    const r = runtime([event()], definition, {
      placement: (_event, t) =>
        t >= 0.1 && t < 0.18
          ? { resolved: false, reasons: ["world:missing-bone:7"] }
          : world.placement(),
    });
    r.advanceTo(0.05);
    const before = r.checkpoint();
    expect(geometry(r)).toHaveLength(1);
    r.advanceTo(0.2);
    expect(geometry(r)).toEqual([]);
    const row = r.coverage({ includeRows: true }).rows[0];
    expect(row.componentOmissions[0].reasons).toContain(
      "world:instance-placement-lost",
    );
    expect(row.componentOmissions[0].reasons).toContain("world:missing-bone:7");
    expect(r.checkpoint().instances).toEqual([]);
    expect(row.reasons).toContain(
      "lifecycle:presentation-retired-after-world-input-loss",
    );
    r.restore(before);
    r.advanceTo(0.08);
    expect(geometry(r)).toHaveLength(1);
  });
  test("malformed programs and supplied input values fail loudly", () => {
    for (const requirements of [
      undefined,
      {},
      { rootBasis: true, boundObjectSize: 1 },
      { rootBasis: true, boundObjectSize: -0 },
      { rootBasis: true, boundObjectSize: null, extra: 1 },
    ]) {
      const d = structuredClone(definition);
      d.emitters[0].placementRequirements = requirements;
      expect(() => runtime([event()], d)).toThrow("placement requirements");
    }
    for (const size of [-1, Infinity, NaN, "0"])
      expect(() =>
        runtime([event()], constrained(), supplied(size)).advanceTo(0.05),
      ).toThrow("bound-object size");
    expect(() =>
      runtime([event()], definition, {
        placement: () => ({ ...world.placement(), basis: [1, 2] }),
      }).advanceTo(0.05),
    ).toThrow("system basis");
  });
});

describe("direct world and definition admission", () => {
  const report = {
    build,
    protocol,
    endTime: 10,
    heroes: [
      {
        entityId: 7,
        champion: "Example",
        skinId: 0,
        creationPosition: [2, 0, 3],
        skinIdStatus: "candidate",
        team: 100,
      },
    ],
    movement: [],
    lifecycle: [],
    casts: [],
    attacks: [],
    missiles: [],
  };
  const scene = {
    build,
    protocol,
    map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
  };
  const terrain = { sampleHeight: () => ({ inside: true, height: 4 }) };
  test("display-facing dependencies do not gate position-only worlds or supply missing renderer assets", () => {
    const view = createLatestWorldPresentation({ report, scene, terrain });
    expect(view.entity(7, 0).position).toEqual([2, 4, 3]);
    expect(() => view.presentViewerPose(7, 0)).toThrow(
      "Static viewer pose assets unavailable",
    );
    expect(() =>
      view.entity(7, 0, { transportSequence: 1, entryOrder: 0 }),
    ).toThrow("original packet ordinals");
  });
  test("same-time world queries respect packet and entry order across motion, lifecycle, resources and attachments", () => {
    const cursor = (transportSequence, entryOrder = 0, exclusive = false) => ({
      transportSequence,
      entryOrder,
      exclusive,
    });
    const motion = (time, sequence, transportSequence, coordinate) => ({
      time,
      sequence,
      transportSequence,
      entityId: 7,
      syncId: sequence,
      speed: 0,
      encodedWaypoints: [[coordinate, coordinate]],
    });
    const decoded = {
      ...report,
      heroes: [
        { ...report.heroes[0], provenance: { time: 0, transportSequence: 1 } },
      ],
      movement: [motion(1, 1, 10, 0), motion(1, 3, 12, 1), motion(2, 5, 21, 2)],
      lifecycle: [
        {
          kind: "death-candidate",
          entityId: 7,
          time: 1,
          sequence: 2,
          transportSequence: 11,
        },
        {
          kind: "respawn-candidate",
          entityId: 7,
          time: 2,
          sequence: 4,
          transportSequence: 20,
          point: [2, 2],
        },
      ],
    };
    const transform = (x) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
    const view = createLatestWorldPresentation({
      report: decoded,
      scene,
      terrain,
      entities: [
        {
          entityId: 8,
          position: [1, 2, 3],
          creationTime: 1,
          creationTransportSequence: 15,
          removalTime: 2,
          removalTransportSequence: 22,
        },
      ],
      resourceTracks: [
        { entityId: 7, time: 0.5, transportSequence: 5, stack: "initial" },
        { entityId: 7, time: 1, transportSequence: 10, stack: "older" },
        {
          entityId: 7,
          time: 1,
          transportSequence: 12,
          entryOrder: 0,
          stack: "newer",
        },
        {
          entityId: 7,
          time: 1,
          transportSequence: 12,
          entryOrder: 1,
          stack: "last-entry",
        },
      ],
      attachmentTracks: [
        {
          entityId: 7,
          key: 3,
          time: 1,
          transportSequence: 10,
          transform: transform(10),
        },
        {
          entityId: 7,
          key: 3,
          time: 1,
          transportSequence: 12,
          transform: transform(12),
        },
      ],
    });
    expect(view.entity(7, 1, cursor(9))).toMatchObject({
      position: [2, 4, 3],
      lifecycle: "alive",
      resourceStack: "initial",
    });
    expect(view.entity(7, 1, cursor(10))).toMatchObject({
      position: [5, 4, 5],
      lifecycle: "alive",
      resourceStack: "older",
    });
    expect(view.entity(7, 1, cursor(11, 0, true)).lifecycle).toBe("alive");
    expect(view.entity(7, 1, cursor(12))).toMatchObject({
      position: [5, 4, 5],
      lifecycle: "dead",
      resourceStack: "newer",
    });
    expect(view.entity(7, 1, cursor(12, 1)).resourceStack).toBe("last-entry");
    expect(view.attachment(7, 3, 1, cursor(9)).resolved).toBe(false);
    expect(view.attachment(7, 3, 1, cursor(11)).transform).toEqual(
      transform(10),
    );
    expect(view.attachment(7, 3, 1, cursor(12)).transform).toEqual(
      transform(12),
    );
    expect(view.entity(7, 2, cursor(19)).lifecycle).toBe("dead");
    expect(view.entity(7, 2, cursor(20))).toMatchObject({
      position: [2, 4, 2],
      lifecycle: "alive",
    });
    expect(view.entity(7, 2, cursor(21)).position).toEqual([9, 4, 9]);
    expect(view.entity(7, 1, cursor(10)).resourceStack).toBe("older");
    const descriptor = Object.fromEntries(
      EFFECT_ENTITY_FIELDS.map((key) => [
        key,
        key === "attachmentEntityId" ? 8 : 0,
      ]),
    );
    expect(view.references(descriptor, 1, cursor(14))[2].status).toBe(
      "inactive",
    );
    expect(view.references(descriptor, 1, cursor(15))[2].status).toBe(
      "registered",
    );
    expect(view.references(descriptor, 2, cursor(22))[2].status).toBe(
      "inactive",
    );
  });
  test("effect birth cannot consume a later same-time motion packet, including after a backward seek", () => {
    const decoded = {
      ...report,
      heroes: [
        { ...report.heroes[0], provenance: { time: 0, transportSequence: 1 } },
      ],
      movement: [0, 1].map((coordinate) => ({
        entityId: 7,
        time: 1,
        sequence: coordinate + 1,
        transportSequence: 10 + coordinate * 2,
        syncId: coordinate + 1,
        speed: 0,
        encodedWaypoints: [[coordinate, coordinate]],
      })),
    };
    const observed = [];
    const view = createLatestWorldPresentation({
      report: decoded,
      scene,
      terrain,
      placementResolver: ({ references, cursor }) => {
        observed.push(cursor);
        return {
          resolved: true,
          position: references[0].entity.position,
          basis: identityBasis,
        };
      },
    });
    const descriptor = Object.fromEntries(
      EFFECT_ENTITY_FIELDS.map((key, i) => [key, i === 0 ? 7 : 0]),
    );
    const r = runtime(
      [event({ time: 1, transportSequence: 11, descriptor })],
      definition,
      view,
    );
    r.advanceTo(1);
    expect(observed.slice(0, 2)).toEqual([
      { transportSequence: 11, entryOrder: 0 },
      { transportSequence: 11, entryOrder: 0 },
    ]);
    expect(view.entity(7, 1).position).toEqual([7, 4, 7]);
    expect([
      ...r.checkpoint().instances[0][1].emitters[0].data.slice(2, 5),
    ]).toEqual([5, 4, 5]);
    const first = geometry(r);
    r.advanceTo(0.5);
    r.advanceTo(1);
    expect(geometry(r)).toEqual(first);
    const legacy = createLatestWorldPresentation({ report, scene, terrain });
    expect(() =>
      legacy.entity(7, 0, { transportSequence: 10, entryOrder: 0 }),
    ).toThrow("original packet ordinals");
    expect(() =>
      legacy.entity(7, 1, { transportSequence: -1, entryOrder: 0 }),
    ).toThrow("original packet ordinals");
  });
  test("all four references remain distinct and unresolved placement is never detached", () => {
    const view = createLatestWorldPresentation({ report, scene, terrain });
    const descriptor = Object.fromEntries(
      EFFECT_ENTITY_FIELDS.map((k, i) => [k, i === 0 ? 7 : i + 10]),
    );
    const refs = view.references(descriptor, 0);
    expect(refs.map((r) => r.field)).toEqual([...EFFECT_ENTITY_FIELDS]);
    expect(refs.map((r) => r.entityId)).toEqual([7, 11, 12, 13]);
    const requests = buildLatestDirectEffectEvents({
      report: {
        ...report,
        effectCreations: [
          {
            opcode: 756,
            entityId: 20,
            creationSequence: 1,
            time: 0,
            transportSequence: 1,
            stream: 1,
            chunkId: 1,
            blockOffset: 0,
            contextId: 0,
            ...descriptor,
          },
        ],
        effectRemovals: [],
      },
      pipeline: {
        events: [
          {
            kind: "create-request",
            creationSequence: 1,
            entityId: 20,
            time: 0,
            transportSequence: 1,
            entryOrder: 1,
          },
        ],
        creation: () => ({
          descriptor,
          resourceStages: { auxiliary: { status: "unprepared-context" } },
        }),
      },
    });
    expect(requests[0]).toMatchObject({
      ownerId: null,
      ownershipStatus: "network-creator-unresolved",
      descriptor,
    });
    const tracked = runtime(requests);
    tracked.advanceTo(0);
    expect(tracked.coverage({ includeRows: true }).rows[0]).toMatchObject({
      ownerId: null,
      ownershipStatus: "network-creator-unresolved",
    });
    expect(view.placement({ descriptor }, 0).resolved).toBe(false);
    expect(() =>
      view.placement(
        {
          descriptor,
          placement: { kind: "explicit-world", position: [1, 2, 3] },
        },
        0,
      ),
    ).toThrow("cannot be converted");
  });
  test("known entity position does not establish resource stacks, visibility or bone transforms", () => {
    const view = createLatestWorldPresentation({
      report,
      scene,
      terrain,
      attachmentTracks: [
        {
          entityId: 7,
          key: 2,
          time: 0,
          transportSequence: 0,
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
    });
    expect(view.entity(7, 0)).toMatchObject({
      resourceStack: null,
      visibility: "unknown",
      position: [2, 4, 3],
    });
    expect(view.attachment(7, 2, 0).resolved).toBe(true);
    expect(view.attachment(7, 2, 0.01).resolved).toBe(false);
    expect(view.attachment(7, 3, 0).resolved).toBe(false);
    expect(view.entity(7, -1)).toBeNull();
  });
  test("repeated missile replication has separate source IDs and exact original packet order", () => {
    const decoded = {
      ...report,
      missiles: [
        {
          entityId: 10,
          sequence: 1,
          time: 1,
          transportSequence: 20,
          cast: { ownerId: 7 },
        },
        {
          entityId: 10,
          sequence: 2,
          time: 1,
          transportSequence: 22,
          cast: { ownerId: 7 },
        },
      ],
    };
    const events = buildLatestDirectEffectEvents({
      report: decoded,
      pipeline: { events: [] },
    });
    expect(events.map((e) => e.id)).toEqual(["missile:10:1", "missile:10:2"]);
    expect(events.map((e) => e.transportSequence)).toEqual([20, 22]);
    const r = runtime(events);
    r.advanceTo(1);
    expect(
      r.coverage({ includeRows: true }).rows.map((r) => r.generation),
    ).toEqual([null, null]);
    expect(() =>
      buildLatestDirectEffectEvents({
        report: {
          ...decoded,
          missiles: [{ ...decoded.missiles[0], transportSequence: undefined }],
        },
        pipeline: { events: [] },
      }),
    ).toThrow("original transport ordinals");
  });
  test("hash checks and unsupported fields prevent broad emitter admission", async () => {
    const sourceEmitter = {
      ...source,
      lifetime: 1,
      bindWeight: field(0),
      SpawnShape: { __type: "{ee39916f}", emitOffset: [0, 0, 0] },
      primitive: { __type: "VfxPrimitiveArbitraryQuad" },
      texture: "example.tex",
      blendMode: 1,
      birthRotation0: {
        __type: "ValueVector3",
        dynamics: {
          __type: "VfxAnimatedVector3fVariableData",
          times: [0],
          values: [[90, 1, 0]],
          probabilityTables: [
            {},
            { keyTimes: [0, 1], keyValues: [0, 360] },
            {},
          ],
        },
      },
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [sourceEmitter],
        },
      }),
    );
    const manifest = {
      build,
      protocol,
      definitions: { example: { sha256: await sha256(bytes) } },
      assets: {
        "example.tex": {
          status: "prepared",
          kind: "texture",
          file: "example.png",
        },
      },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const options = {
      id: "example",
      definitionBytes: bytes,
      manifest,
      manifestBytes,
      kernels: {
        values,
        birth,
        emission,
        samplers: {
          describe: () => ({ previewSupported: true, name: "clamp" }),
        },
      },
    };
    expect((await compileLatestDirectEffect(options)).emitters).toHaveLength(1);
    for (const [angular, primitive, admitted] of [
      [field([12, 0, -30], "ValueVector3"), "VfxPrimitiveArbitraryQuad", true],
      [field([12, 0, -30], "ValueVector3"), "VfxPrimitiveCameraQuad", false],
      [
        { ...field([12, 0, 0], "ValueVector3"), dynamics: {} },
        "VfxPrimitiveArbitraryQuad",
        false,
      ],
      [field([12, 0], "ValueVector3"), "VfxPrimitiveArbitraryQuad", false],
      [
        field([12, 0, 1e40], "ValueVector3"),
        "VfxPrimitiveArbitraryQuad",
        false,
      ],
      [null, "VfxPrimitiveArbitraryQuad", false],
    ]) {
      const definitionBytes = new TextEncoder().encode(
        JSON.stringify({
          definition: {
            __type: "VfxSystemDefinitionData",
            complexEmitterDefinitionData: [
              {
                ...sourceEmitter,
                primitive: { __type: primitive },
                birthRotationalVelocity0: angular,
              },
            ],
          },
        }),
      );
      const candidateManifest = {
        ...manifest,
        definitions: { example: { sha256: await sha256(definitionBytes) } },
      };
      const result = await compileLatestDirectEffect({
        ...options,
        definitionBytes,
        manifest: candidateManifest,
        manifestBytes: new TextEncoder().encode(
          JSON.stringify(candidateManifest),
        ),
      });
      expect(result.emitters.length).toBe(admitted ? 1 : 0);
      if (admitted)
        expect(result.emitters[0].angularVelocity).toEqual([12, 0, -30]);
    }
    for (const [shape, admitted] of [
      [undefined, true],
      [null, false],
      [{ __type: "UnknownShape" }, false],
    ]) {
      const candidate = { ...sourceEmitter, SpawnShape: shape };
      const definitionBytes = new TextEncoder().encode(
        JSON.stringify({
          definition: {
            __type: "VfxSystemDefinitionData",
            complexEmitterDefinitionData: [candidate],
          },
        }),
      );
      const candidateManifest = {
        ...manifest,
        definitions: { example: { sha256: await sha256(definitionBytes) } },
      };
      const result = await compileLatestDirectEffect({
        ...options,
        definitionBytes,
        manifest: candidateManifest,
        manifestBytes: new TextEncoder().encode(
          JSON.stringify(candidateManifest),
        ),
      });
      expect(result.emitters.length).toBe(admitted ? 1 : 0);
      if (admitted) expect(result.emitters[0].offset).toEqual([0, 0, 0]);
    }
    for (const [alphaRef, admitted] of [
      [0, true],
      [0.5, false],
      [false, false],
    ]) {
      const definitionBytes = new TextEncoder().encode(
        JSON.stringify({
          definition: {
            __type: "VfxSystemDefinitionData",
            complexEmitterDefinitionData: [{ ...sourceEmitter, alphaRef }],
          },
        }),
      );
      const candidateManifest = {
        ...manifest,
        definitions: { example: { sha256: await sha256(definitionBytes) } },
      };
      const result = await compileLatestDirectEffect({
        ...options,
        definitionBytes,
        manifest: candidateManifest,
        manifestBytes: new TextEncoder().encode(
          JSON.stringify(candidateManifest),
        ),
      });
      expect(result.emitters.length).toBe(admitted ? 1 : 0);
      if (!admitted)
        expect(result.unsupported[0].reasons).toContain(
          "material:alpha-ref-threshold",
        );
    }
    await expect(
      compileLatestDirectEffect({
        ...options,
        definitionBytes: new TextEncoder().encode("{}"),
      }),
    ).rejects.toThrow("content differs");
    sourceEmitter.worldAcceleration = field([0, -1, 0], "ValueVector3");
    const modified = new TextEncoder().encode(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [sourceEmitter],
        },
      }),
    );
    manifest.definitions.example.sha256 = await sha256(modified);
    const compiled = await compileLatestDirectEffect({
      ...options,
      definitionBytes: modified,
      manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    });
    expect(compiled.emitters).toHaveLength(0);
    expect(compiled.unsupported[0].reasons).toContain(
      "field:worldAcceleration",
    );
  });
});
