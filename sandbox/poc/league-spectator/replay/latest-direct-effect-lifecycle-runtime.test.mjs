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
  ),
  profile = await Bun.file(new URL("profile.json", root)).json(),
  kernels = await createDirectEffectKernels({
    profile,
    packages: Object.fromEntries(
      await Promise.all(
        ["values", "birth", "emission", "samplers"].map(async (name) => [
          name,
          await Bun.file(new URL(`vfx-${name}.json`, root)).bytes(),
        ]),
      ),
    ),
  }),
  field = (constantValue, __type = "ValueFloat") => ({ __type, constantValue }),
  refs = {
    resourceContextEntityId: 0,
    lookup14EntityId: 0,
    attachmentEntityId: 0,
    lookupA8EntityId: 0,
  },
  camera = { right: [1, 0, 0], up: [0, 1, 0] },
  world = {
    placement: () => ({
      resolved: true,
      position: [1, 2, 3],
      basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }),
  };

async function compiled(overrides = {}) {
  const source = {
      rate: field(12),
      particleLifetime: field(2),
      lifetime: 10,
      particleLinger: 0.125,
      particleLingerType: 2,
      emitterLinger: 0,
      isSingleParticle: false,
      bindWeight: field(0),
      birthScale0: field([2, 2, 1], "ValueVector3"),
      birthRotation0: field([0, 0, 0], "ValueVector3"),
      texture: "fixture.tex",
      blendMode: 1,
      ...overrides,
    },
    bytes = new TextEncoder().encode(
      JSON.stringify({
        definition: {
          __type: "VfxSystemDefinitionData",
          complexEmitterDefinitionData: [
            source,
            {
              emitterName: "untranslated-sibling",
              primitive: { __type: "VfxPrimitiveMesh" },
            },
          ],
        },
      }),
    ),
    manifest = {
      build,
      protocol,
      assets: { "fixture.tex": { kind: "texture", status: "prepared" } },
      definitions: { fixture: { sha256: await sha256(bytes) } },
    },
    result = await compileLatestDirectEffect({
      id: "fixture",
      definitionBytes: bytes,
      manifest,
      manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
      kernels,
    });
  expect(result.emitters).toHaveLength(1);
  expect(result.emitters[0].lifecycleProgram).not.toBeNull();
  expect(result.unsupported.some((e) => e.index === 1)).toBe(true);
  return result;
}
function events(
  definition,
  { time = 69, removeAt = null, reasonByte = 61 } = {},
) {
  const creations = [
      {
        opcode: 756,
        entityId: 1,
        time,
        transportSequence: 10,
        creationSequence: 0,
        stream: 1,
        chunkId: 1,
        blockOffset: 10,
        contextId: 0,
        ...refs,
      },
    ],
    removals = (
      removeAt === null ? [] : Array.isArray(removeAt) ? removeAt : [removeAt]
    ).map((time, index) => {
      const reason = Array.isArray(reasonByte) ? reasonByte[index] : reasonByte;
      return {
        opcode: 187,
        entityId: 1,
        time,
        transportSequence: 11 + index,
        removalSequence: index,
        stream: 1,
        chunkId: 1,
        blockOffset: 20 + index,
        contextId: 0,
        reasonByte: reason,
        requestedFlagMask: reason === 61 ? 0x800 : 0x10000000,
      };
    }),
    normalized = [
      {
        id: "network-effect:1:0",
        kind: "create",
        origin: "network-effect",
        entityId: 1,
        time,
        transportSequence: 10,
        entryOrder: 0,
        creationSequence: 0,
        descriptor: refs,
        definitionId: definition.id,
        seedHex: "0000000000000001",
      },
      ...removals.map((r) => ({
        id: `network-removal:1:${r.removalSequence}`,
        kind: "removal-request",
        origin: "network-effect",
        entityId: 1,
        time: r.time,
        transportSequence: r.transportSequence,
        entryOrder: 0,
        removalSequence: r.removalSequence,
        requestedFlags: r.requestedFlagMask,
      })),
    ];
  return linkLatestNetworkEffectLifecycle({
    events: normalized,
    creations,
    removals,
  });
}
function runtime(definition, requests = events(definition)) {
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: definition.contentHash,
    replayHash: "b".repeat(64),
    definitions: new Map([[definition.id, definition]]),
    events: requests,
    world,
    kernels,
    checkpointSeconds: 0.25,
    maximumCheckpoints: 32,
  });
}
const instance = (r) => r.checkpoint().instances[0]?.[1];
const draw = (r) =>
  r
    .generateDraws(camera)
    .draws.map((d) =>
      Object.fromEntries(
        Object.entries(d).map(([key, value]) => [
          key,
          ArrayBuffer.isView(value) ? Array.from(value) : value,
        ]),
      ),
    );

test("natural continuous-emitter stop retains tails and never establishes omitted parent completion", async () => {
  const definition = await compiled({ lifetime: 0.5 }),
    r = runtime(definition);
  r.advanceTo(69.45);
  expect(instance(r).emitters[0].count).toBeGreaterThan(0);
  r.advanceTo(69.6);
  const stopped = instance(r).emitters[0],
    last = stopped.lastEmissionTime;
  expect(stopped.lifecycle.stopTime).toBeGreaterThan(0.5);
  expect(stopped.count).toBeGreaterThan(0);
  r.advanceTo(69.65);
  if (instance(r)) expect(instance(r).emitters[0].lastEmissionTime).toBe(last);
  r.advanceTo(70);
  expect(instance(r)).toBeUndefined();
  const row = r.coverage({ includeRows: true }).rows[0];
  expect(row.presentationRetirement).toBe(
    "compiled-components-finished-native-siblings-unresolved",
  );
  expect(row).not.toHaveProperty("nativeParentComplete", true);
});

test("translated linked removal rewrites tails on the local clock at a nonzero replay origin", async () => {
  const definition = await compiled(),
    r = runtime(definition, events(definition, { removeAt: 69.5 }));
  r.advanceTo(69.45);
  const original = instance(r).emitters[0];
  expect(original.count).toBeGreaterThan(0);
  for (let i = 0; i < original.count; i++) {
    const at = i * 20;
    expect(original.data[at]).toBeGreaterThanOrEqual(69);
    expect(original.data[at + 19]).toBe(Math.fround(original.data[at] - 69));
  }
  r.advanceTo(69.55);
  const current = instance(r).emitters[0];
  expect(current.lifecycle.stopTime).toBeGreaterThanOrEqual(0.5);
  expect(current.lifecycle.stopTime).toBeLessThan(1);
  for (let i = 0; i < current.count; i++) {
    const at = i * 20;
    expect(current.data[at + 1]).toBe(
      Math.fround(
        Math.fround(current.lifecycle.stopTime - current.data[at + 19]) + 0.125,
      ),
    );
  }
  const row = r.coverage({ includeRows: true }).rows[0];
  expect(row.translatedRemovalRequests).toEqual([
    expect.objectContaining({
      id: "network-removal:1:0",
      policy: "linked-presentation-emitter-stop-and-tail-v1",
      nativeWorldLookupAcceptance: null,
      nativeParentCompletion: null,
      emitterIndices: [0],
    }),
  ]);
  r.advanceTo(69.8);
  expect(instance(r)).toBeUndefined();
});

test("lifecycle particles and random state agree across 1x/4x, paused cameras and repeated seeks", async () => {
  const definition = await compiled(),
    requests = events(definition, { removeAt: 69.5 }),
    a = runtime(definition, requests),
    b = runtime(definition, requests);
  for (let tick = 0; tick <= 36; tick++) a.advanceTo(69 + tick / 60);
  for (let tick = 0; tick <= 36; tick += 4) b.advanceTo(69 + tick / 60);
  b.advanceTo(69.6);
  expect(instance(a).emitters[0].count).toBeGreaterThan(0);
  expect(a.checkpoint()).toEqual(b.checkpoint());
  a.advanceTo(69.4);
  const first = draw(a),
    saved = a.checkpoint();
  a.generateDraws({ right: [0, 0, 1], up: [0, 1, 0] });
  expect(a.checkpoint()).toEqual(saved);
  a.advanceTo(69.8);
  a.advanceTo(69.4);
  expect(draw(a)).toEqual(first);
  a.advanceTo(69.8);
  a.advanceTo(69.4);
  expect(a.checkpoint()).toEqual(saved);
});

test("compiled lifecycle programs cannot be removed, forged or detached from their source", async () => {
  const definition = await compiled();
  for (const mutate of [
    (d) => {
      delete d.emitters[0].lifecycleProgram;
    },
    (d) => {
      d.emitters[0].lifecycleProgram = null;
    },
    (d) => {
      d.emitters[0].lifecycleProgram.linkTimers[0] = 99;
    },
    (d) => {
      d.emitters[0].source.particleLifetime.constantValue = 9;
    },
  ]) {
    const changed = structuredClone(definition);
    mutate(changed);
    expect(() => runtime(changed)).toThrow("lifecycle program");
  }
});

test("repeated requests cannot resurrect the cleared wrapper effect or reapply a different branch", async () => {
  const definition = await compiled({ particleLinger: 1 }),
    r = runtime(
      definition,
      events(definition, {
        removeAt: [69.5, 69.6, 69.7],
        reasonByte: [61, 61, 62],
      }),
    );
  r.advanceTo(69.55);
  const first = instance(r),
    stopTime = first.emitters[0].lifecycle.stopTime;
  expect(first.lifecycleEffectPresent).toBe(false);
  expect(first.lifecycleObjectFlags).toBe(0x800);
  r.advanceTo(69.61);
  expect(instance(r).lifecycleEffectPresent).toBe(false);
  r.advanceTo(69.71);
  const last = instance(r);
  expect(last).toBeDefined();
  expect(last.lifecycleEffectPresent).toBe(false);
  expect(last.lifecycleObjectFlags).toBe(0x800);
  expect(last.lifecycleParentFlags).toBe(first.lifecycleParentFlags);
  expect(last.emitters[0].lifecycle.stopTime).toBe(stopTime);
  expect(
    r.coverage({ includeRows: true }).rows[0].removalRequests,
  ).toHaveLength(3);
});

test("forged linked bytes and causal target identities cannot select a retirement branch", async () => {
  const definition = await compiled(),
    requests = events(definition, { removeAt: 69.5 });
  for (const mutate of [
    (e) => {
      e.removalInput.reasonByte = 62;
    },
    (e) => {
      e.removalInput.targetCreation.entityId = 2;
    },
    (e) => {
      e.removalInput.targetCreation.transportSequence = 9;
    },
    (e) => {
      e.removalInput.targetCreation.entityReferences.attachmentEntityId = 99;
    },
  ]) {
    const changed = structuredClone(requests);
    mutate(changed[1]);
    expect(() => runtime(definition, changed)).toThrow();
  }
});
