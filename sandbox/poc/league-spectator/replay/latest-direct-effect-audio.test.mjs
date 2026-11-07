import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const kernels = {
  birth: {
    sampleValue: (field, _time, fallback) => field?.constantValue ?? fallback,
    createRandom: () => ({
      next: () => 0.5,
      snapshot: () => ({}),
      restore: () => {},
    }),
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: () => ({ count: 0 }),
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
async function compile(root = {}) {
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          {
            __type: "VfxEmitterDefinitionData",
            texture: "control.png",
            blendMode: 1,
            lifetime: 1,
            rate: { __type: "ValueFloat", constantValue: 1 },
            particleLifetime: { __type: "ValueFloat", constantValue: 1 },
            birthScale0: { __type: "ValueVector3", constantValue: [1, 1, 1] },
          },
        ],
        ...root,
      },
    }),
  );
  const id = "generic/shared/0123abcd";
  const manifest = {
    build,
    protocol,
    definitions: { [id]: { sha256: await sha256(definitionBytes) } },
    assets: { "control.png": { kind: "texture", status: "prepared" } },
  };
  return compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels,
  });
}
function runtime(d) {
  return new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: d.contentHash,
    replayHash: "0".repeat(64),
    definitions: new Map([[d.id, d]]),
    kernels,
    // Supplied native component control with a known identity root transform.
    world: {
      placement: () => ({
        resolved: true,
        position: [1, 2, 3],
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }),
    },
    events: [
      {
        id: "audio:0",
        kind: "create",
        origin: "network-effect",
        entityId: 7,
        definitionId: d.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
      },
    ],
  });
}

test("only verified root String declarations become explicit visual-slice omissions", async () => {
  const absent = await compile();
  expect(absent.systemAudio).toEqual({
    soundOnCreateDefault: { value: "", authored: false },
    soundPersistentDefault: { value: "", authored: false },
  });
  for (const value of [
    "",
    "arbitrary_sound_identity",
    "音声/イベント",
    "x".repeat(4095),
  ]) {
    for (const key of ["soundOnCreateDefault", "soundPersistentDefault"]) {
      const d = await compile({ [key]: value });
      expect(d.systemAudio[key]).toEqual({ value, authored: true });
      expect(Object.isFrozen(d.systemAudio[key])).toBe(true);
      expect(d.blockers).toEqual([]);
      expect(d.emitters).toHaveLength(1);
      expect(d.systemOmissions).toEqual([
        ...absent.systemOmissions,
        `system:audio:${key}:enqueue-playback-device-and-handle-lifecycle`,
      ]);
    }
  }
  expect((await compile({ soundOnCreate: "untranslated" })).blockers).toContain(
    "system:soundOnCreate",
  );
  expect(
    (await compile({ soundPersistent: "untranslated" })).blockers,
  ).toContain("system:soundPersistent");
  expect(
    (await compile({ flags: 132, soundOnCreateDefault: "typed" })).blockers,
  ).toContain("system:flags");
});

test("root audio String metadata rejects coercion, embedded NUL and oversized values", async () => {
  for (const key of ["soundOnCreateDefault", "soundPersistentDefault"])
    for (const value of [
      null,
      false,
      true,
      1,
      {},
      [],
      "a\0b",
      "x".repeat(4096),
      "音".repeat(1366),
    ])
      await expect(compile({ [key]: value })).rejects.toThrow(
        "bounded String without NUL",
      );
});

test("authored sound identity and omissions survive activation, blocking and checkpoints", async () => {
  for (const flags of [212, 132]) {
    const d = await compile({
      flags,
      soundOnCreateDefault: "create",
      soundPersistentDefault: "persistent",
    });
    const r = runtime(d);
    r.advanceTo(0);
    const row = r.coverage({ includeRows: true }).rows[0];
    expect(row.systemAudio).toEqual(d.systemAudio);
    expect(row.systemOmissions).toEqual(d.systemOmissions);
    expect(row.reasons).toEqual(expect.arrayContaining(d.systemOmissions));
    expect(row.runtimeActivated).toBe(flags === 212);
    expect(r.coverage().complete).toBeNull();
    const saved = r.checkpoint();
    expect(saved.contract.runtimeVersion).toBe(DIRECT_EFFECT_PROGRAM_VERSION);
    if (row.runtimeActivated)
      expect(saved.instances[0][1].systemAudio).toEqual(d.systemAudio);
    r.advanceTo(0.1);
    r.restore(saved);
    expect(r.coverage({ includeRows: true }).rows[0]).toEqual(row);
    row.systemAudio.soundOnCreateDefault.value = "response mutation";
    expect(
      r.coverage({ includeRows: true }).rows[0].systemAudio.soundOnCreateDefault
        .value,
    ).toBe("create");
    saved.contract.runtimeVersion = 16;
    expect(() => r.restore(saved)).toThrow(
      "Incompatible direct effect checkpoint",
    );
  }
});

test("runtime rejects corrupt provided v17 audio metadata before accepting events", async () => {
  const d = await compile();
  for (const systemAudio of [
    undefined,
    null,
    {},
    [],
    { ...d.systemAudio, extra: "unknown" },
    Object.assign(Object.create(d.systemAudio), { unexpected: 1, other: 2 }),
    {
      ...d.systemAudio,
      soundOnCreateDefault: { value: "coerced", authored: 1 },
    },
    {
      ...d.systemAudio,
      soundOnCreateDefault: { value: "not-default", authored: false },
    },
    {
      ...d.systemAudio,
      soundOnCreateDefault: { value: "a\0b", authored: true },
    },
    {
      ...d.systemAudio,
      soundOnCreateDefault: { value: "x".repeat(4096), authored: true },
    },
    {
      ...d.systemAudio,
      soundOnCreateDefault: { value: "", authored: false, extra: 0 },
    },
  ])
    expect(() => runtime({ ...d, systemAudio })).toThrow(
      "systemAudio metadata",
    );
});
