import { expect, test } from "bun:test";
import {
  directCameraBasisIndependent,
  DIRECT_CAMERA_ORIENTATION_OMISSION,
} from "./latest-direct-effect-orientation.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const camera = () => ({ primitive: "camera-quad", offset: [0, 0, 0] });
test("only camera programs with proven positive-zero local position and velocity can omit root basis", () => {
  expect(directCameraBasisIndependent(camera())).toBe(true);
  expect(
    directCameraBasisIndependent({
      ...camera(),
      emitterPosition: [0, 0, 0],
      velocity: [0, 0, 0],
    }),
  ).toBe(true);
  for (const primitive of [
    "arbitrary-quad",
    "camera-trail",
    undefined,
    "unknown",
  ])
    expect(directCameraBasisIndependent({ ...camera(), primitive })).toBe(
      false,
    );
  for (const key of ["offset", "emitterPosition", "velocity"])
    for (const value of [
      null,
      [],
      [0, 0],
      [0, 0, 0, 0],
      [0, 5, 0],
      [0, -0, 0],
      [0, "0", 0],
      [0, false, 0],
      new Float32Array(3),
    ])
      expect(directCameraBasisIndependent({ ...camera(), [key]: value })).toBe(
        false,
      );
  const sparse = Array(3);
  expect(directCameraBasisIndependent({ ...camera(), offset: sparse })).toBe(
    false,
  );
  const extra = [0, 0, 0];
  extra.unknown = 0;
  expect(directCameraBasisIndependent({ ...camera(), offset: extra })).toBe(
    false,
  );
});

async function compile(extra = {}) {
  const id = "generic/camera-orientation-control";
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          {
            __type: "VfxEmitterDefinitionData",
            texture: "control.png",
            blendMode: 1,
            ...extra,
          },
        ],
      },
    }),
  );
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
    kernels: {
      birth: {
        sampleValue: (v, _time, fallback) => v?.constantValue ?? fallback,
        createRandom: () => ({ next: () => 0.5 }),
      },
      emission: { eligibility: () => ({ reasons: [] }) },
      samplers: { describe: () => ({ previewSupported: true }) },
    },
  });
}
test("typed particle-local flags retain raw values and native orientation omissions in the bounded camera slice", async () => {
  for (const flag of [undefined, 0, 1, false, true]) {
    const d = await compile(
      flag === undefined ? {} : { particleIsLocalOrientation: flag },
    );
    expect(d.emitters).toHaveLength(1);
    expect(d.emitters[0].source.particleIsLocalOrientation).toBe(flag);
    expect(d.emitters[0].placementRequirements).toEqual({
      rootBasis: false,
      boundObjectSize: null,
    });
    expect(d.emitters[0].omissions).toContain(
      DIRECT_CAMERA_ORIENTATION_OMISSION,
    );
  }
  for (const flag of [null, "true", 2, -1, {}, []]) {
    const d = await compile({ particleIsLocalOrientation: flag });
    expect(d.emitters).toHaveLength(0);
    expect(d.unsupported[0].reasons).toContain(
      "binding:particle-local-orientation-type",
    );
  }
});
test("nonzero position, velocity and arbitrary geometry retain their native root-basis gates", async () => {
  for (const extra of [
    { EmitterPosition: { __type: "ValueVector3", constantValue: [0, 5, 0] } },
    {
      birthVelocity: { __type: "ValueVector3", constantValue: [0, 1, 0] },
      isSingleParticle: 1,
    },
    { primitive: { __type: "VfxPrimitiveArbitraryQuad" } },
  ]) {
    const ordinary = await compile(extra);
    expect(ordinary.emitters[0].placementRequirements.rootBasis).toBe(true);
    const local = await compile({ ...extra, particleIsLocalOrientation: true });
    expect(local.emitters).toHaveLength(0);
    expect(local.unsupported[0].reasons).toContain(
      "binding:particle-local-orientation-root-basis-untranslated",
    );
  }
  const malformed = await compile({
    birthVelocity: { __type: "ValueVector3", constantValue: 3 },
  });
  expect(malformed.emitters).toHaveLength(0);
  expect(malformed.unsupported[0].reasons).toContain(
    "motion:birth-velocity-constant",
  );
});
