import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
  DIRECT_EFFECT_PROGRAM_VERSION,
} from "./latest-direct-effect-runtime.mjs";
import {
  DIRECT_GROUND_OMISSIONS,
  DIRECT_GROUND_POLICY,
  DIRECT_GROUND_PACKAGE_SHA,
  directGroundMaterials,
} from "./latest-direct-ground-policy.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "./latest-direct-effect-package.mjs";
import { DIRECT_CAMERA_ORIENTATION_OMISSION } from "./latest-direct-effect-orientation.mjs";

const kernels = {
  birth: {
    sampleValue: (field, _t, fallback) => field?.constantValue ?? fallback,
    createRandom: () => ({
      next: () => 0.5,
      snapshot: () => ({}),
      restore() {},
    }),
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: () => ({ count: 0 }),
  },
  samplers: { describe: () => ({ previewSupported: true }) },
};
async function compile(properties = {}) {
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          {
            __type: "VfxEmitterDefinitionData",
            texture: "control.png",
            lifetime: 1,
            rate: { __type: "ValueFloat", constantValue: 1 },
            particleLifetime: { __type: "ValueFloat", constantValue: 1 },
            birthScale0: { __type: "ValueVector3", constantValue: [1, 1, 1] },
            ...properties,
          },
        ],
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    definitions: {
      "arbitrary/ground": {
        sha256: await sha256(definitionBytes),
      },
    },
    assets: {
      "control.png": { kind: "texture", status: "prepared" },
    },
  };
  return compileLatestDirectEffect({
    id: "arbitrary/ground",
    definitionBytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels,
  });
}

test("ground typed booleans preserve ordinary geometry and explicit material omissions", async () => {
  for (const value of [true, 1, false, 0, undefined]) {
    const d = await compile(
      value === undefined ? {} : { isGroundLayer: value },
    );
    const e = d.emitters[0];
    expect(e.primitive).toBe("camera-quad");
    expect(e.groundLayer).toBe(!!value);
    expect(e.materialPolicy).toBe(value ? DIRECT_GROUND_POLICY : null);
    expect(e.omissions).toEqual([
      DIRECT_CAMERA_ORIENTATION_OMISSION,
      ...(value ? DIRECT_GROUND_OMISSIONS : []),
    ]);
  }
  for (const isGroundLayer of [null, "true", 2, -1, {}, []]) {
    const d = await compile({ isGroundLayer });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain("material:ground-layer-type");
  }
});

test("native ground pass5 package rejects pass0, absent FoW and incorrect identity", async () => {
  const base = `${process.cwd()}/.cache/replay-spike/public`;
  const bytes = await Bun.file(
    `${base}/latest-direct-ground-materials/package.json`,
  ).bytes();
  expect(await sha256(bytes)).toBe(DIRECT_GROUND_PACKAGE_SHA);
  const p = JSON.parse(new TextDecoder().decode(bytes));
  const manifestBytes = await Bun.file(
    `${base}/latest-effects/manifest.json`,
  ).bytes();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const hash = await sha256(manifestBytes);
  expect(directGroundMaterials(p, manifest, hash).size).toBe(13);
  for (const mutate of [
    (x) => {
      x.emitters[0].environment.pass = 0;
    },
    (x) => {
      x.emitters[0].sourceDefinitionSha256 = "0".repeat(64);
    },
    (x) => {
      x.scenePolicy.rgbaHex = "00000000";
    },
    (x) => {
      x.scenePolicy.uniformBytesHex = "00000000000000000000000000000000";
    },
    (x) => {
      x.emitters[0].textures = {};
    },
    (x) => {
      x.scenePolicy.omissions = [];
    },
  ]) {
    const altered = structuredClone(p);
    mutate(altered);
    expect(() => directGroundMaterials(altered, manifest, hash)).toThrow();
  }
});

test("shared static loader selects actual pass5 bindings for all thirteen ground components", async () => {
  const base = `${process.cwd()}/.cache/replay-spike/public`;
  const load = (path) => Bun.file(`${base}/${path}`).bytes();
  const p = await Bun.file(
    `${base}/latest-direct-ground-materials/package.json`,
  ).json();
  const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: [...new Set(p.emitters.map((e) => e.effectId))],
  });
  for (const b of p.emitters) {
    const program = prepared.definitions
      .get(b.effectId)
      .emitters.find((e) => e.index === b.emitterIndex);
    expect(program.groundLayer).toBe(true);
    expect(program.omissions).toEqual([
      ...(!program.lifecycleProgram
        ? [
            program.single
              ? "lifecycle:single-link-controller-count-unresolved"
              : "lifecycle:constant-life-quad-controller-required",
          ]
        : []),
      ...(!program.placementRequirements.rootBasis
        ? [DIRECT_CAMERA_ORIENTATION_OMISSION]
        : []),
      ...DIRECT_GROUND_OMISSIONS,
    ]);
    expect(
      prepared.materials.get(program.materialKey).prepared.environment.pass,
    ).toBe(5);
    expect(
      prepared.materials.get(program.materialKey).prepared.materialPolicy,
    ).toBe(DIRECT_GROUND_POLICY);
  }
});

test("ground component omissions survive active creation and checkpoint restore; v14 rejected", async () => {
  const d = await compile({ isGroundLayer: true });
  const runtime = new LatestDirectEffectRuntime({
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
        id: "ground:0",
        kind: "create",
        origin: "network-effect",
        entityId: 1,
        definitionId: d.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
      },
    ],
  });
  runtime.advanceTo(0);
  const row = runtime.coverage({ includeRows: true }).rows[0];
  expect(row.runtimeActivated).toBe(true);
  expect(row.componentOmissions).toEqual([
    {
      index: 0,
      reasons: [DIRECT_CAMERA_ORIENTATION_OMISSION, ...DIRECT_GROUND_OMISSIONS],
    },
  ]);
  expect(row.reasons).toEqual(
    expect.arrayContaining(
      DIRECT_GROUND_OMISSIONS.map((r) => `emitter:0:${r}`),
    ),
  );
  expect(runtime.coverage().complete).toBeNull();
  const checkpoint = runtime.checkpoint();
  expect(checkpoint.contract.runtimeVersion).toBe(
    DIRECT_EFFECT_PROGRAM_VERSION,
  );
  runtime.advanceTo(0.1);
  runtime.restore(checkpoint);
  expect(runtime.coverage({ includeRows: true }).rows[0]).toEqual(row);
  checkpoint.contract.runtimeVersion = 14;
  expect(() => runtime.restore(checkpoint)).toThrow(
    "Incompatible direct effect checkpoint",
  );
});
