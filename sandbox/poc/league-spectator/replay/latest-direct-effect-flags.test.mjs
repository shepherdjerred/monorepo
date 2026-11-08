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
  const manifest = {
    build,
    protocol,
    definitions: {
      "arbitrary/shared-effect": { sha256: await sha256(definitionBytes) },
    },
    assets: { "control.png": { kind: "texture", status: "prepared" } },
  };
  return compileLatestDirectEffect({
    id: "arbitrary/shared-effect",
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
        id: "flags:0",
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

test("root uint16 default and proven values preserve exact authored identity and partial omissions", async () => {
  const absent = await compile();
  expect(absent.systemFlags).toEqual({ value: 212, authored: false });
  expect(absent.systemOmissions).toHaveLength(3);
  expect(absent.systemOmissions).toContain(
    "system:wrapper-view-dependent-simulation-and-culling",
  );
  expect(Object.isFrozen(absent.systemOmissions)).toBe(true);
  for (const flags of [196, 197, 198, 212, 213, 214]) {
    const d = await compile({ flags });
    expect(d.systemFlags).toEqual({ value: flags, authored: true });
    expect(d.blockers).toEqual([]);
    expect(d.emitters).toHaveLength(1);
    expect(d.systemOmissions).toEqual(absent.systemOmissions);
  }
});

test("root flags reject malformed types and retain unproven uint16 scheduler dependencies", async () => {
  for (const flags of [null, false, true, "212", {}, [], -1, 65536, 212.5])
    await expect(compile({ flags })).rejects.toThrow("exact uint16");
  for (const flags of [0, 1, 132, 148, 200, 32768, 65535]) {
    const d = await compile({ flags });
    expect(d.systemFlags).toEqual({ value: flags, authored: true });
    expect(d.blockers).toContain("system:flags");
  }
  expect(
    (await compile({ flags: 198, soundOnCreate: "sound" })).blockers,
  ).toContain("system:soundOnCreate");
});

test("active and blocked creation ledgers expose raw flags and root omissions across seek checkpoints", async () => {
  for (const root of [{}, { flags: 197 }, { flags: 132 }]) {
    const d = await compile(root),
      r = runtime(d);
    r.advanceTo(0);
    const coverage = r.coverage({ includeRows: true });
    const row = coverage.rows[0];
    expect(row.systemFlags).toEqual(d.systemFlags);
    expect(row.systemOmissions).toEqual(d.systemOmissions);
    expect(row.reasons).toEqual(expect.arrayContaining(d.systemOmissions));
    expect(row.runtimeActivated).toBe(!d.blockers.length);
    expect(coverage.complete).toBeNull();
    const saved = r.checkpoint();
    expect(saved.contract.runtimeVersion).toBe(DIRECT_EFFECT_PROGRAM_VERSION);
    expect(d.programVersion).toBe(DIRECT_EFFECT_PROGRAM_VERSION);
    if (row.runtimeActivated) {
      expect(saved.instances[0][1].systemFlags).toEqual(d.systemFlags);
      expect(saved.instances[0][1].systemOmissions).toEqual(d.systemOmissions);
    }
    r.advanceTo(0.1);
    r.restore(saved);
    expect(r.coverage({ includeRows: true }).rows[0]).toEqual(row);
    saved.contract.runtimeVersion = 12;
    expect(() => r.restore(saved)).toThrow(
      "Incompatible direct effect checkpoint",
    );
  }
});
