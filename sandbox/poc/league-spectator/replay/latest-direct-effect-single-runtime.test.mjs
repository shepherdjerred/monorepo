import { expect, test } from "bun:test";
import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { linkLatestNetworkEffectLifecycle } from "./latest-network-effect-lifecycle.mjs";
import { sha256 } from "./structural-comparison.mjs";

const root = new URL(
  "../../../../.cache/replay-spike/public/decoder-16.21-macos/",
  import.meta.url,
);
const profile = await Bun.file(new URL("profile.json", root)).json();
const kernels = await createDirectEffectKernels({
  profile,
  packages: Object.fromEntries(
    await Promise.all(
      ["values", "birth", "emission", "samplers"].map(async (name) => [
        name,
        await Bun.file(new URL(`vfx-${name}.json`, root)).bytes(),
      ]),
    ),
  ),
});
const field = (constantValue, __type = "ValueFloat") => ({
  __type,
  constantValue,
});
const refs = {
  resourceContextEntityId: 0,
  lookup14EntityId: 0,
  attachmentEntityId: 0,
  lookupA8EntityId: 0,
};
const world = {
  placement: () => ({
    resolved: true,
    position: [0, 0, 0],
    basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  }),
};

async function compile(overrides = {}) {
  const source = {
    rate: field(1),
    particleLifetime: field(0.5),
    isSingleParticle: true,
    bindWeight: field(0),
    birthScale0: field([2, 2, 1], "ValueVector3"),
    birthRotation0: field([0, 0, 0], "ValueVector3"),
    texture: "single.tex",
    blendMode: 1,
    ...overrides,
  };
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          source,
          { primitive: { __type: "VfxPrimitiveMesh" } },
        ],
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    assets: { "single.tex": { kind: "texture", status: "prepared" } },
    definitions: { fixture: { sha256: await sha256(bytes) } },
  };
  return compileLatestDirectEffect({
    id: "fixture",
    definitionBytes: bytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels,
  });
}
function requests(definition, removeAt = null) {
  const creations = [
    {
      opcode: 756,
      entityId: 1,
      time: 69,
      transportSequence: 10,
      creationSequence: 0,
      stream: 1,
      chunkId: 1,
      blockOffset: 10,
      contextId: 0,
      ...refs,
    },
  ];
  const removals =
    removeAt === null
      ? []
      : [
          {
            opcode: 187,
            entityId: 1,
            time: removeAt,
            transportSequence: 11,
            removalSequence: 0,
            stream: 1,
            chunkId: 1,
            blockOffset: 20,
            contextId: 0,
            reasonByte: 61,
            requestedFlagMask: 0x800,
          },
        ];
  const events = [
    {
      id: "network-effect:1:0",
      kind: "create",
      origin: "network-effect",
      entityId: 1,
      time: 69,
      transportSequence: 10,
      entryOrder: 0,
      creationSequence: 0,
      descriptor: refs,
      definitionId: definition.id,
      seedHex: "0000000000000001",
    },
    ...removals.map((r) => ({
      id: "network-removal:1:0",
      kind: "removal-request",
      origin: "network-effect",
      entityId: 1,
      time: r.time,
      transportSequence: r.transportSequence,
      entryOrder: 0,
      removalSequence: 0,
      requestedFlags: r.requestedFlagMask,
    })),
  ];
  return linkLatestNetworkEffectLifecycle({ events, creations, removals });
}
function runtime(definition, events = requests(definition)) {
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: definition.contentHash,
    replayHash: "b".repeat(64),
    definitions: new Map([[definition.id, definition]]),
    events,
    world,
    kernels,
    checkpointSeconds: 0.25,
    maximumCheckpoints: 32,
  });
}
const instance = (r) => r.checkpoint().instances[0]?.[1];

test("single resource prefix keeps raw source and pre-rewrite timers while normalizing actor/birth clocks", async () => {
  const scale = {
    __type: "ValueVector3",
    constantValue: [1, 1, 1],
    dynamics: {
      __type: "VfxAnimatedVector3fVariableData",
      times: [0, 1],
      values: [
        [1, 1, 1],
        [3, 3, 1],
      ],
    },
  };
  const d = await compile({
    timeBeforeFirstEmission: 0.13,
    emitterLinger: 11,
    birthScale0: scale,
  });
  expect(d.emitters).toHaveLength(1);
  const p = d.emitters[0];
  expect(p.source.lifetime).toBe(Math.fround(3.4028234663852886e38));
  expect(p.singleResourceProgram.sourceLifetime).toBe(p.source.lifetime);
  expect(p.singleResourceProgram.effectiveLifetime).toBe(0.5);
  expect(p.lifetime).toBe(0.5);
  expect(p.lifecycleProgram.lifetime).toBe(0.5);
  expect(p.lifecycleProgram.linkTimers[1]).toBe(11);
  const r = runtime(d);
  r.advanceTo(69.14);
  const e = instance(r).emitters[0];
  expect(e.lifecycle.linkControllerCount).toBe(0);
  expect(e.count).toBe(1);
  const elapsed = Math.fround(Math.fround(69 + 8 / 60) - 69);
  const local = Math.fround(elapsed - Math.fround(0.13));
  const expected = kernels.values.sample(
    scale,
    Math.fround(local / 0.5),
    [0, 0, 0],
  );
  expect(e.data[9]).toBe(expected[0]);
  expect(e.data[9]).toBeGreaterThan(1);
  expect(e.data[19]).toBe(Math.fround(e.data[0] - 69));
});

test("linked reason61 removal stops a live single and preserves unresolved native parent completion", async () => {
  const d = await compile({ particleLifetime: field(2), lifetime: 1 });
  const r = runtime(d, requests(d, 69.25));
  r.advanceTo(69.2);
  expect(instance(r).emitters[0].count).toBe(1);
  r.advanceTo(69.3);
  const row = r.coverage({ includeRows: true }).rows[0];
  expect(row.translatedRemovalRequests).toHaveLength(1);
  expect(row.translatedRemovalRequests[0].nativeParentCompletion).toBeNull();
  expect(row.translatedRemovalRequests[0].emitterIndices).toEqual([0]);
  expect(instance(r)).toBeUndefined();
});

test("single particle/RNG state agrees at 1x/4x, pause and repeated backward seeks", async () => {
  const d = await compile({
    particleLifetime: field(2),
    particleLinger: 1,
    timeBeforeFirstEmission: 0.13,
  });
  const events = requests(d, 69.5),
    a = runtime(d, events),
    b = runtime(d, events);
  for (let tick = 0; tick <= 36; tick++) a.advanceTo(69 + tick / 60);
  for (let tick = 0; tick <= 36; tick += 4) b.advanceTo(69 + tick / 60);
  b.advanceTo(69.6);
  expect(instance(a).emitters[0].count).toBe(1);
  expect(a.checkpoint()).toEqual(b.checkpoint());
  a.advanceTo(69.4);
  const saved = a.checkpoint();
  a.generateDraws({ right: [0, 0, 1], up: [0, 1, 0] });
  expect(a.checkpoint()).toEqual(saved);
  a.advanceTo(70.1);
  a.advanceTo(69.4);
  expect(a.checkpoint()).toEqual(saved);
  a.advanceTo(70.1);
  a.advanceTo(69.4);
  expect(a.checkpoint()).toEqual(saved);
});

test("single metadata cannot be removed, forged or detached from its authored clock and controller source", async () => {
  const definition = await compile();
  for (const mutate of [
    (d) => {
      delete d.emitters[0].singleResourceProgram;
    },
    (d) => {
      d.emitters[0].singleResourceProgram = null;
    },
    (d) => {
      d.emitters[0].singleResourceProgram.linkControllerCount = 1;
    },
    (d) => {
      d.emitters[0].singleResourceProgram.effectiveLifetime = 1;
    },
    (d) => {
      d.emitters[0].lifetime = 10;
    },
    (d) => {
      d.emitters[0].lifecycleProgram.linkTimers[1] = 1;
    },
    (d) => {
      d.emitters[0].source.materialOverrideDefinitions = [null];
    },
  ]) {
    const changed = structuredClone(definition);
    mutate(changed);
    expect(() => runtime(changed)).toThrow();
  }
});

test("nonempty override resources remain omitted and never become zero-count single controllers", async () => {
  const definition = await compile({
    materialOverrideDefinitions: [
      { __type: "VfxMaterialOverrideDefinitionData" },
    ],
  });
  expect(definition.emitters).toHaveLength(0);
  expect(definition.unsupported[0].reasons).toContain(
    "field:materialOverrideDefinitions",
  );
});
