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

const assets = new URL(
    "../../../../.cache/replay-spike/public/",
    import.meta.url,
  ),
  decoder = new URL("decoder-16.21-macos/", assets),
  manifestBytes = await Bun.file(
    new URL("latest-effects/manifest.json", assets),
  ).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  id = "champions/karthus/10/ce863744",
  ref = manifest.definitions[id],
  sourceBytes = await Bun.file(
    new URL(`latest-effects/${ref.file}`, assets),
  ).bytes(),
  source = JSON.parse(new TextDecoder().decode(sourceBytes)),
  profile = await Bun.file(new URL("profile.json", decoder)).json(),
  kernels = await createDirectEffectKernels({
    profile,
    packages: Object.fromEntries(
      await Promise.all(
        ["values", "birth", "emission", "samplers"].map(async (name) => [
          name,
          await Bun.file(new URL(`vfx-${name}.json`, decoder)).bytes(),
        ]),
      ),
    ),
  });
if ((await sha256(sourceBytes)) !== ref.sha256)
  throw Error("Installed Karthus definition differs");
async function compile(mutate = null) {
  if (!mutate)
    return compileLatestDirectEffect({
      id,
      definitionBytes: sourceBytes,
      manifest,
      manifestBytes,
      kernels,
    });
  const derived = structuredClone(source);
  mutate(derived.definition);
  const bytes = new TextEncoder().encode(JSON.stringify(derived)),
    controlManifest = structuredClone(manifest);
  controlManifest.definitions[id].sha256 = await sha256(bytes);
  return compileLatestDirectEffect({
    id,
    definitionBytes: bytes,
    manifest: controlManifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(controlManifest)),
    kernels,
  });
}
const refs = {
  resourceContextEntityId: 0,
  lookup14EntityId: 0,
  attachmentEntityId: 0,
  lookupA8EntityId: 0,
};
function events(definition, removeAt = null, seedHex = "0000000000000001") {
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
    ],
    removals =
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
  return linkLatestNetworkEffectLifecycle({
    creations,
    removals,
    events: [
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
        seedHex,
      },
      ...removals.map((row) => ({
        id: "network-removal:1:0",
        kind: "removal-request",
        origin: "network-effect",
        entityId: 1,
        time: row.time,
        transportSequence: 11,
        entryOrder: 0,
        removalSequence: 0,
        requestedFlags: 0x800,
      })),
    ],
  });
}
function runtime(definition, requests = events(definition)) {
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: definition.contentHash,
    replayHash: "c".repeat(64),
    definitions: new Map([[definition.id, definition]]),
    events: requests,
    world: {
      placement: () => ({
        resolved: true,
        position: [1, 2, 3],
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }),
    },
    kernels,
    checkpointSeconds: 0.25,
    maximumCheckpoints: 32,
  });
}
const instance = (r) => r.checkpoint().instances[0]?.[1];
const emitter = (r, index) =>
  instance(r)?.emitters.find((e) => e.index === index);
const lives = (e) =>
  Array.from({ length: e.count }, (_, i) => e.data[i * 20 + 1]);

test("actual Karthus singleton-probability lives retain birth sampling and original resource maximum", async () => {
  const d = await compile();
  for (const [index, maximum] of [
    [0, 2],
    [2, 4],
    [3, 2],
  ]) {
    const p = d.emitters.find((e) => e.index === index);
    expect(p).toBeDefined();
    expect(p.lifecycleProgram.particleLifetime).toBe(maximum);
    expect(p.lifecycleProgram.particleLifetimeResource).toEqual({
      schema: 1,
      policy: "native-value-float-maximum-v1",
      kind: "singleton-resource",
      maximum,
      sourceKeyCount: 1,
      probabilityIncludedInMaximum: false,
    });
    expect(p.source.particleLifetime).toEqual(
      source.definition.complexEmitterDefinitionData[index].particleLifetime,
    );
    expect(p.singleResourceProgram).toBeNull();
  }
  const sampled = [];
  for (const seed of ["0000000000000001", "0000000000012345"]) {
    const r = runtime(d, events(d, null, seed));
    r.advanceTo(70.2);
    for (const [index, maximum] of [
      [0, 2],
      [2, 4],
      [3, 2],
    ]) {
      const e = emitter(r, index);
      expect(e.count).toBeGreaterThan(0);
      for (const life of lives(e)) {
        expect(life).toBeGreaterThanOrEqual(maximum * 0.5);
        expect(life).toBeLessThanOrEqual(maximum);
        sampled.push(life / maximum);
      }
    }
  }
  expect(sampled.some((v) => v < 1)).toBe(true);
  expect(new Set(sampled).size).toBeGreaterThan(1);
});

test("actual curve-life linked removal stops births and clamps admitted tails without sibling completion claims", async () => {
  const d = await compile(),
    r = runtime(d, events(d, 70.25));
  r.advanceTo(70.2);
  for (const index of [0, 2, 3])
    expect(emitter(r, index).count).toBeGreaterThan(0);
  // The event is applied after the preceding simulation slice; the next
  // canonical actor tick consumes its stop/tail decision.
  r.advanceTo(70.27);
  for (const index of [0, 2, 3]) {
    const e = emitter(r, index),
      p = d.emitters.find((e) => e.index === index);
    expect(e.count).toBeGreaterThan(0);
    for (const life of lives(e))
      expect(life).toBeLessThanOrEqual(p.lifecycleProgram.linkTimers[0]);
  }
  const stopped = instance(r)?.emitters.map((e) => [
    e.index,
    e.lastEmissionTime,
  ]);
  r.advanceTo(70.4);
  for (const [index, last] of stopped ?? [])
    if (emitter(r, index))
      expect(emitter(r, index).lastEmissionTime).toBe(last);
  for (const index of [0, 2, 3]) expect(emitter(r, index)?.count ?? 0).toBe(0);
  const row = r.coverage({ includeRows: true }).rows[0];
  expect(row.translatedRemovalRequests).toHaveLength(1);
  expect(row.translatedRemovalRequests[0].emitterIndices).toEqual(
    expect.arrayContaining([0, 2, 3]),
  );
  expect(row.translatedRemovalRequests[0].nativeParentCompletion).toBeNull();
  expect(
    row.translatedRemovalRequests[0].nativeWorldLookupAcceptance,
  ).toBeNull();
});

test("actual variable-life particle/RNG checkpoints agree at 1x/4x, camera pause and repeated removal seeks", async () => {
  const d = await compile(),
    requests = events(d, 70.25),
    a = runtime(d, requests),
    b = runtime(d, requests);
  for (let tick = 0; tick <= 96; tick++) a.advanceTo(69 + tick / 60);
  for (let tick = 0; tick <= 96; tick += 4) b.advanceTo(69 + tick / 60);
  expect(a.checkpoint()).toEqual(b.checkpoint());
  a.advanceTo(70.2);
  const saved = a.checkpoint();
  expect(emitter(a, 0).count).toBeGreaterThan(0);
  a.generateDraws({ right: [0, 0, 1], up: [0, 1, 0] });
  expect(a.checkpoint()).toEqual(saved);
  for (let i = 0; i < 2; i++) {
    a.advanceTo(70.6);
    a.advanceTo(70.2);
    expect(a.checkpoint()).toEqual(saved);
  }
});

test("resource maximum metadata is constructor validated against raw probability source", async () => {
  const d = await compile();
  for (const mutate of [
    (p) => {
      delete p.lifecycleProgram.particleLifetimeResource;
    },
    (p) => {
      p.lifecycleProgram.particleLifetimeResource = null;
    },
    (p) => {
      p.lifecycleProgram.particleLifetimeResource.maximum = 99;
    },
    (p) => {
      p.lifecycleProgram.particleLifetimeResource.probabilityIncludedInMaximum = true;
    },
    (p) => {
      p.lifecycleProgram.particleLifetime = 99;
    },
    (p) => {
      p.source.particleLifetime.dynamics.values[0] = 99;
    },
    (p) => {
      p.lifecycleProgram.linkTimers[0] = 99;
    },
  ]) {
    const forged = structuredClone(d);
    mutate(forged.emitters.find((p) => p.index === 0));
    expect(() => runtime(forged)).toThrow("lifecycle program");
  }
});

test("multi-key life curves keep the controller omission instead of guessing a maximum", async () => {
  const d = await compile((definition) => {
    const life = definition.complexEmitterDefinitionData[0].particleLifetime;
    life.dynamics.times = [0, 1];
    life.dynamics.values = [2, 2];
  });
  expect(d.emitters.some((p) => p.index === 0)).toBe(false);
  const omitted = d.unsupported.find((p) => p.index === 0);
  expect(omitted).toBeDefined();
  expect(omitted.reasons).toContain("birth:lifetime-curve-clock");
});
