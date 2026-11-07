import { expect, test } from "bun:test";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { normalizeDirectPointEmitter } from "./latest-direct-effect-defaults.mjs";
import {
  LatestDirectEffectRuntime,
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { directRenderAttributes } from "./latest-direct-effect-draw.mjs";
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
  values: {
    sample: (field, _time, fallback) => field?.constantValue ?? fallback,
  },
  emission: {
    eligibility: () => ({ reasons: [] }),
    count: (_source, state) => ({ count: state.hasEmitted ? 0 : 1 }),
    birthOrigins: (_previous, current) => [current],
    commitBirth: (emitter) => {
      emitter.hasEmitted = true;
    },
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
            texture: "native.png",
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
      "shared/component": {
        sha256: await sha256(definitionBytes),
      },
    },
    assets: {
      "native.png": { kind: "texture", status: "prepared" },
    },
  };
  return compileLatestDirectEffect({
    id: "shared/component",
    definitionBytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels,
  });
}

test("absent blend uses original UInt8 zero and preserves the exact authored material key", async () => {
  expect(normalizeDirectPointEmitter({}).blendMode).toBe(0);
  const d = await compile();
  expect(d.emitters).toHaveLength(1);
  expect(d.emitters[0].blend).toBe(0);
  expect(d.emitters[0].source.blendMode).toBe(0);
  expect(d.emitters[0].materialKey).toBe("shared/component:0");
  for (const blendMode of [0, 1, 4]) {
    const authored = await compile({ blendMode });
    expect(authored.emitters[0].blend).toBe(blendMode);
    expect(authored.emitters[0].materialKey).toBe("shared/component:0");
  }
});

test("unverified blend and active alpha-test properties retain precise omissions", async () => {
  for (const blendMode of [null, false, true, "0", 2, 3, 255]) {
    const d = await compile({ blendMode });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      `material:blend:${blendMode ?? "unprepared-default"}`,
    );
  }
  const active = await compile({ alphaRef: 0.1 });
  expect(active.emitters).toHaveLength(0);
  expect(active.unsupported[0].reasons).toContain(
    "material:alpha-ref-threshold",
  );
});

test("mode zero retains original premultiplied packed color across camera draws and seek", async () => {
  const d = await compile({
    isSingleParticle: true,
    birthColor: { __type: "ValueColor", constantValue: [0.2, 0.4, 0.8, 0.5] },
    Color: { __type: "ValueColor", constantValue: [0.5, 0.7, 0.9, 0.3] },
  });
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
        position: [0, 0, 0],
        basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      }),
    },
    events: [
      {
        id: "blend:0",
        kind: "create",
        origin: "animation",
        entityId: 1,
        definitionId: d.id,
        time: 0,
        transportSequence: 0,
        entryOrder: 0,
      },
    ],
  });
  runtime.advanceTo(0);
  const saved = runtime.checkpoint();
  const render = (camera) =>
    directRenderAttributes(runtime.generateDraws(camera).draws[0]);
  const first = render({ right: [1, 0, 0], up: [0, 1, 0] });
  // Exact BGRA bytes from original 0x173075a color fragment + 0x148f090 packer,
  // control color(.2,.4,.8,.5) and multiplier(.5,.7,.9,.3).
  expect([...first.a_COLOR.subarray(0, 4)]).toEqual([27, 10, 3, 255]);
  expect([...render({ right: [0, 0, 1], up: [0, 1, 0] }).a_COLOR]).toEqual([
    ...first.a_COLOR,
  ]);
  expect(runtime.checkpoint()).toEqual(saved);
  runtime.advanceTo(0.5);
  runtime.restore(saved);
  expect([...render({ right: [1, 0, 0], up: [0, 1, 0] }).a_COLOR]).toEqual([
    ...first.a_COLOR,
  ]);
});

test("quad draw attributes retain native HDR and negative low-byte color packing", async () => {
  for (const [blendMode, expected] of [
    [0, [15, 225, 63, 255]],
    [1, [127, 1, 254, 31]],
    [4, [127, 1, 254, 31]],
  ]) {
    const d = await compile({
      isSingleParticle: true,
      blendMode,
      birthColor: { __type: "ValueColor", constantValue: [2, -1, 0.5, 0.125] },
    });
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
          position: [0, 0, 0],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        }),
      },
      events: [
        {
          id: "hdr:0",
          kind: "create",
          origin: "animation",
          entityId: 1,
          definitionId: d.id,
          time: 0,
          transportSequence: 0,
          entryOrder: 0,
        },
      ],
    });
    runtime.advanceTo(0.1);
    const packed = directRenderAttributes(
      runtime.generateDraws({ right: [1, 0, 0], up: [0, 1, 0] }).draws[0],
    );
    expect([...packed.a_COLOR.subarray(0, 4)]).toEqual(expected);
  }
});
