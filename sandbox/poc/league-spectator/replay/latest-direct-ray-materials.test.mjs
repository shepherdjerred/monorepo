import { expect, test } from "bun:test";
import {
  directRaySceneOmissions,
  packDirectRayFrameUniforms,
} from "./latest-direct-ray-materials.mjs";

const requirement = () => ({
  blocks: [
    {
      stage: "vertex",
      name: "Frame",
      size: 64,
      requiredMembers: [{ name: "mProj", size: 64 }],
    },
  ],
  textures: [{ name: "FOW", dimension: "texture2d" }],
  dataBuffers: [],
});
const scene = () => ({
  uniforms: {
    mProj: new Uint8Array(
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer,
    ),
  },
  textures: {
    FOW: {
      dimension: "texture2d",
      width: 1,
      height: 1,
      rgba: new Uint8Array([255, 255, 255, 255]),
      samplerDescriptorHex: "01010100000000000000000100000000",
      samplerParameters: { 10240: 9729 },
      inputPolicy: "supplied-unit-control",
    },
  },
  stencilReference: 0,
  blendColor: [0, 0, 0, 0],
});
test("Ray material reports every missing scene dependency without choosing replacements", () => {
  expect(directRaySceneOmissions(requirement(), {})).toEqual([
    "scene:uniform:vertex:Frame:mProj",
    "scene:texture:FOW",
    "scene:pipeline:stencilReference",
    "scene:pipeline:blendColor",
  ]);
  expect(directRaySceneOmissions(requirement(), scene())).toEqual([]);
  expect(
    directRaySceneOmissions(
      { ...requirement(), dataBuffers: [{ name: "CellData" }] },
      scene(),
    ),
  ).toEqual(["scene:unimplemented-data-buffer:CellData"]);
});
test("Ray material rejects incomplete matrices, incompatible textures and unknown pipeline values", () => {
  const partial = scene();
  partial.uniforms.mProj = new Uint8Array(16);
  expect(() => directRaySceneOmissions(requirement(), partial)).toThrow(
    "whole-vector",
  );
  const malformed = scene();
  malformed.textures.FOW.rgba = new Uint8Array(3);
  expect(() => directRaySceneOmissions(requirement(), malformed)).toThrow(
    "texture/sampler",
  );
  expect(() =>
    directRaySceneOmissions(requirement(), {
      ...scene(),
      stencilReference: -1,
    }),
  ).toThrow("stencil");
  expect(() =>
    directRaySceneOmissions(requirement(), {
      ...scene(),
      blendColor: Array(4),
    }),
  ).toThrow("blend-color");
});
test("Ray binding reuses reflected native constant packing with complete owned frame bytes", () => {
  const stage = {
    sidecar: {
      textures: [],
      blocks: [
        {
          glslName: "Frame",
          size: 64,
          members: [{ name: "mProj", offset: 0, size: 64, used: true }],
        },
      ],
    },
  };
  const selected = {
    status: "prepared-native-parent-material",
    emitterIndex: 5,
    passHash: 27,
    variant: {
      constantBuffers: [],
      requiredScene: {
        ...requirement(),
        blocks: [{ ...requirement().blocks[0], binding: 1 }],
      },
    },
  };
  const values = scene().uniforms,
    before = values.mProj.slice();
  const out = packDirectRayFrameUniforms(
    selected,
    [stage, { sidecar: { textures: [], blocks: [] } }],
    values,
  );
  expect(out).toHaveLength(1);
  expect(out[0].bytes).toEqual(before);
  expect(out[0].binding).toBe(1);
  expect(out[0].bytes.buffer).not.toBe(values.mProj.buffer);
  out[0].bytes.fill(17);
  expect(values.mProj).toEqual(before);
  expect(() =>
    packDirectRayFrameUniforms(selected, [stage, stage], {
      mProj: new Uint8Array(16),
    }),
  ).toThrow("Complete explicit");
});
