import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const emitter = {
  __type: "VfxEmitterDefinitionData",
  emitterName: "identity-control",
  texture: "control.png",
  blendMode: 1,
  lifetime: 1,
  rate: { __type: "ValueFloat", constantValue: 1 },
  particleLifetime: { __type: "ValueFloat", constantValue: 1 },
  birthScale0: { __type: "ValueVector3", constantValue: [1, 1, 1] },
};
const kernels = {
  birth: {
    sampleValue: (field, _age, fallback) => field?.constantValue ?? fallback,
    createRandom: () => ({ next: () => 0.5 }),
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: () => ({ count: 0 }),
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
async function compile({
  id = "arbitrary/resources/abcdef01",
  root = {},
  recordId,
  complex = [emitter],
  simple = [],
} = {}) {
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      id: recordId,
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: complex,
        simpleEmitterDefinitionData: simple,
        ...root,
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    definitions: { [id]: { sha256: await sha256(definitionBytes) } },
    assets: { "control.png": { kind: "texture", status: "prepared" } },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes,
    kernels,
  });
}

test("authored root HASH is retained as unsigned identity for arbitrary resource IDs", async () => {
  for (const hash of [
    "00000000",
    "00000001",
    "80000000",
    "ffffffff",
    "abcdef01",
  ]) {
    const d = await compile({
      id: `unrelated/type/${hash}`,
      recordId: hash,
      root: { objectPath: `{${hash}}` },
    });
    expect(d.systemIdentity).toEqual({
      objectPathHash: Number.parseInt(hash, 16),
      authored: true,
    });
    expect(Object.isFrozen(d.systemIdentity)).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.childResourceAncestryRequired).toBe(false);
    expect(d.emitters).toHaveLength(1);
  }
});

test("an absent root HASH retains native constructor zero without substituting definition identity", async () => {
  const d = await compile({ recordId: "abcdef01" });
  expect(d.systemIdentity).toEqual({ objectPathHash: 0, authored: false });
  expect(d.blockers).toEqual([]);
  expect((await compile({ id: "test/component" })).systemIdentity).toEqual({
    objectPathHash: 0,
    authored: false,
  });
});

test("malformed, unknown and mismatched HASH values fail the content contract", async () => {
  for (const objectPath of [
    null,
    1,
    {},
    "abcdef01",
    "{abcdef}",
    "{abcdef012}",
    "{unknown!}",
    "{12345678}",
    "{00000000}",
  ]) {
    await expect(compile({ root: { objectPath } })).rejects.toThrow(
      "objectPath HASH",
    );
  }
  await expect(
    compile({ recordId: "12345678", root: { objectPath: "{abcdef01}" } }),
  ).rejects.toThrow("record identity");
  await expect(compile({ recordId: "{abcdef01}" })).rejects.toThrow(
    "record identity",
  );
  await expect(
    compile({ id: "test/no-hash", root: { objectPath: "{abcdef01}" } }),
  ).rejects.toThrow("objectPath HASH");
});

test("child ancestry declarations keep their root dependency and per-emitter omission", async () => {
  for (const childParticleSetDefinition of [
    null,
    {},
    [],
    { __type: "VfxChildParticleSetDefinitionData", childrenIdentifiers: [] },
  ]) {
    const d = await compile({
      root: { objectPath: "{abcdef01}" },
      complex: [
        emitter,
        {
          ...emitter,
          emitterName: "untranslated-child",
          childParticleSetDefinition,
        },
      ],
    });
    expect(d.systemIdentity.objectPathHash).toBe(0xabcdef01);
    expect(d.childResourceAncestryRequired).toBe(true);
    expect(d.blockers).toContain("system:child-resource-ancestry");
    expect(d.emitters.map((e) => e.index)).toEqual([0]);
    expect(d.unsupported[0].reasons).toContain(
      "field:childParticleSetDefinition",
    );
  }
  const nested = await compile({
    simple: [{ unknownContainer: { childParticleSetDefinition: null } }],
  });
  expect(nested.childResourceAncestryRequired).toBe(true);
  expect(nested.blockers).toContain("system:child-resource-ancestry");
  expect(nested.unsupported[0].reasons).toContain("simple-emitter");
});

test("unknown root metadata, audio and flags are not waived by identity admission", async () => {
  const d = await compile({
    root: {
      objectPath: "{abcdef01}",
      flags: 0,
      soundOnCreate: "unverified",
      childParticleSystem: {},
    },
  });
  expect(d.blockers).toEqual([
    "system:flags",
    "system:soundOnCreate",
    "system:childParticleSystem",
  ]);
});

test("earlier checkpoints cannot retain stale admission or motion state", async () => {
  const d = await compile({ root: { objectPath: "{abcdef01}" } });
  const runtime = new LatestDirectEffectRuntime({
    build,
    protocol,
    contentHash: d.contentHash,
    replayHash: "0".repeat(64),
    definitions: new Map([[d.id, d]]),
    events: [],
    world: { placement: () => ({ resolved: false }) },
    kernels,
  });
  const old = runtime.checkpoint();
  expect(old.contract.runtimeVersion).toBe(DIRECT_EFFECT_PROGRAM_VERSION);
  for (const version of [9, 10, 11, 12]) {
    old.contract.runtimeVersion = version;
    expect(() => runtime.restore(old)).toThrow(
      "Incompatible direct effect checkpoint",
    );
  }
});
