import { expect, test } from "bun:test";
import {
  directStaticMeshAttributes,
  directStaticMeshSceneOmissions,
  packDirectStaticMeshUniforms,
  directStaticMeshIndividualDrawValues,
  overlayDirectStaticMeshConstants,
} from "./latest-direct-static-mesh-materials.mjs";
const individual = () => ({
  mWorld: new Float32Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]),
  kColorFactor: new Float32Array([0.25, 0.5, 0.75, 1]),
  vParticleUVTransform: new Float32Array([
    2, 0, -0.5, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  ]),
  COLOR_LOOKUP_UV: new Float32Array([0.125, 1, 0, 0]),
  DYNAMIC_MESH_CENTER: new Float32Array([7, 8, 9]),
});
test("individual mesh binding copies final post-setter matrix bytes and exact original mode-zero controls", () => {
  const draw = individual();
  const values = directStaticMeshIndividualDrawValues({
    drawParameters: draw,
    matrixOrder: "post-1916f70",
    individualMode: 0,
  });
  expect(values.mWorld).toEqual(new Uint8Array(draw.mWorld.buffer));
  expect(new Float32Array(values.mWorld.buffer)).toEqual(draw.mWorld);
  expect(new Float32Array(values.DYNAMIC_MESH_CENTER.buffer)).toEqual(
    new Float32Array([7, 8, 9, 1]),
  );
  expect(values.USE_INSTANCE_DRAW).toEqual(new Uint8Array(16));
  expect(values.INSTANCE_OFFSET).toEqual(new Uint8Array(16));
  draw.mWorld.fill(0);
  expect(new Float32Array(values.mWorld.buffer)[1]).toBe(2);
  for (const options of [
    { matrixOrder: "raw-173cb70", individualMode: 0 },
    { matrixOrder: "post-1916f70", individualMode: 1 },
    { individualMode: 0 },
  ])
    expect(() =>
      directStaticMeshIndividualDrawValues({
        drawParameters: individual(),
        ...options,
      }),
    ).toThrow("post-setter");
  const malformed = individual();
  malformed.kColorFactor[2] = NaN;
  expect(() =>
    directStaticMeshIndividualDrawValues({
      drawParameters: malformed,
      matrixOrder: "post-1916f70",
      individualMode: 0,
    }),
  ).toThrow("finite");
});
test("original individual CPU color UV lookup updates overlay only exact reflected material lanes", () => {
  const values = directStaticMeshIndividualDrawValues({
    drawParameters: individual(),
    matrixOrder: "post-1916f70",
    individualMode: 0,
  });
  const constants = [
    {
      stage: "vertex",
      name: "Globals_vs",
      bytesHex: "00".repeat(64),
      gpuReadbackSha256: "a".repeat(64),
    },
    {
      stage: "pixel",
      name: "Globals_ps",
      bytesHex: "a1a0a03c112233440000000000000000",
      gpuReadbackSha256: "b".repeat(64),
    },
  ];
  const stages = [
    {
      sidecar: {
        blocks: [
          {
            glslName: "Globals_vs",
            size: 64,
            members: [
              { name: "kColorFactor", offset: 0, size: 16, used: true },
              {
                name: "vParticleUVTransform",
                offset: 16,
                size: 48,
                used: true,
              },
            ],
          },
        ],
      },
    },
    {
      sidecar: {
        blocks: [
          {
            glslName: "Globals_ps",
            size: 16,
            members: [
              { name: "COLOR_LOOKUP_UV", offset: 8, size: 8, used: true },
            ],
          },
        ],
      },
    },
  ];
  const out = overlayDirectStaticMeshConstants(
    { constantBuffers: constants },
    stages,
    values,
  );
  expect(out.updates.map((u) => u.name)).toEqual([
    "kColorFactor",
    "vParticleUVTransform",
    "COLOR_LOOKUP_UV",
  ]);
  const vertex = Uint8Array.fromHex(out.constantBuffers[0].bytesHex);
  expect(vertex.subarray(0, 16)).toEqual(values.kColorFactor);
  expect(vertex.subarray(16)).toEqual(values.vParticleUVTransform);
  expect(out.constantBuffers[1].bytesHex.slice(0, 16)).toBe("a1a0a03c11223344");
  expect(
    Uint8Array.fromHex(out.constantBuffers[1].bytesHex).subarray(8),
  ).toEqual(values.COLOR_LOOKUP_UV.subarray(0, 8));
  expect(constants[0].bytesHex).toBe("00".repeat(64));
  expect(out.constantBuffers[0].gpuReadbackSha256).toBeUndefined();
  expect(out.constantBuffers[0].gpuOverlayParityVerified).toBe(false);
  const wrong = structuredClone(stages);
  wrong[0].sidecar.blocks[0].members[1].size = 32;
  expect(() =>
    overlayDirectStaticMeshConstants(
      { constantBuffers: constants },
      wrong,
      values,
    ),
  ).toThrow("Unproven");
});
const attributes = [
  { semantic: "POSITION", index: 0, mask: 7, glslName: "a_POSITION" },
  { semantic: "NORMAL", index: 0, mask: 7, glslName: "a_NORMAL" },
  { semantic: "TEXCOORD", index: 0, mask: 3, glslName: "a_TEXCOORD" },
];
const requirements = () => ({
  blocks: [
    {
      stage: "vertex",
      name: "PerDraw",
      requiredMembers: [{ name: "mWorld", size: 64, scalar: "float" }],
    },
  ],
  textures: [],
  dataBuffers: [
    {
      name: "ParticleMeshInstanceInfo_SharedDataBuffer",
      elementBytes: 208,
      adapter: "uint-data-texture",
    },
  ],
});
test("structured instance records remain separate from reflected constant blocks", () => {
  const required = requirements();
  Object.assign(required.blocks[0], { binding: 1, size: 64 });
  Object.assign(required.dataBuffers[0], { stage: "vertex" });
  const selection = {
    status: "prepared-native-parent-material",
    emitterIndex: 15,
    passHash: 27,
    variant: { constantBuffers: [], requiredScene: required },
  };
  const stages = [
    {
      sidecar: {
        textures: [
          {
            name: "ParticleMeshInstanceInfo_SharedDataBuffer",
            dimension: "buffer",
          },
        ],
        blocks: [
          {
            name: "PerDraw",
            glslName: "PerDraw",
            size: 64,
            members: [{ name: "mWorld", offset: 0, size: 64, used: true }],
          },
          {
            name: "ParticleMeshInstanceInfo_SharedDataBuffer",
            glslName: "ParticleMeshInstanceInfo_SharedDataBuffer",
            size: 208,
            members: [{ name: "$Element", offset: 0, size: 208, used: true }],
          },
        ],
      },
    },
    { sidecar: { textures: [], blocks: [] } },
  ];
  const supplied = scene(),
    packed = packDirectStaticMeshUniforms(selection, stages, supplied);
  expect(packed).toHaveLength(1);
  expect(packed[0].bytes).toEqual(supplied.uniforms.mWorld);
  expect(packed[0].bytes.buffer).not.toBe(supplied.uniforms.mWorld.buffer);
  expect(stages[0].sidecar.blocks).toHaveLength(2);
  const foreign = structuredClone(selection);
  foreign.variant.requiredScene.dataBuffers = [];
  expect(() => packDirectStaticMeshUniforms(foreign, stages, supplied)).toThrow(
    "Unowned",
  );
});
const scene = () => ({
  uniforms: {
    mWorld: new Uint8Array(
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer,
    ),
  },
  dataBuffers: {
    ParticleMeshInstanceInfo_SharedDataBuffer: {
      elementBytes: 208,
      bytes: new Uint8Array(208),
      inputPolicy: "explicit-diagnostic-only-no-native-layout-claim",
    },
  },
  stencilReference: 0,
  blendColor: [0, 0, 0, 0],
});
test("static mesh inputs retain native normals and 36-byte source layout rather than packed quad fields", () => {
  const fields = directStaticMeshAttributes(attributes);
  expect(fields.map((f) => [f.semantic, f.offset, f.stride])).toEqual([
    ["POSITION", 0, 36],
    ["NORMAL", 12, 36],
    ["TEXCOORD", 28, 36],
  ]);
  const color = directStaticMeshAttributes([
    ...attributes,
    { semantic: "COLOR", index: 0, mask: 15, glslName: "a_COLOR" },
  ]).at(-1);
  expect([color.offset, color.type, color.normalized]).toEqual([
    24,
    "uint8",
    true,
  ]);
  for (const changed of [
    [...attributes, attributes[0]],
    [{ ...attributes[0], mask: 15 }, ...attributes.slice(1)],
    [
      ...attributes,
      { semantic: "TEXCOORD", index: 1, mask: 3, glslName: "a_TEXCOORD1" },
    ],
    new Array(3),
    attributes.filter((a) => a.semantic !== "NORMAL"),
  ])
    expect(() => directStaticMeshAttributes(changed)).toThrow("Unproven");
});
test("mesh scene omissions retain original mWorld and 208-byte instance dependency independently", () => {
  expect(directStaticMeshSceneOmissions(requirements(), {})).toEqual([
    "scene:uniform:vertex:PerDraw:mWorld",
    "scene:data-buffer:ParticleMeshInstanceInfo_SharedDataBuffer",
    "scene:pipeline:stencilReference",
    "scene:pipeline:blendColor",
  ]);
  expect(directStaticMeshSceneOmissions(requirements(), scene())).toEqual([]);
  const noInstances = scene();
  delete noInstances.dataBuffers;
  expect(directStaticMeshSceneOmissions(requirements(), noInstances)).toEqual([
    "scene:data-buffer:ParticleMeshInstanceInfo_SharedDataBuffer",
  ]);
});
test("partial or nonfinite matrices, guessed instance widths and malformed explicit state fail loudly", () => {
  const partial = scene();
  partial.uniforms.mWorld = new Uint8Array(16);
  expect(() => directStaticMeshSceneOmissions(requirements(), partial)).toThrow(
    "Complete",
  );
  const nonfinite = scene();
  new DataView(nonfinite.uniforms.mWorld.buffer).setFloat32(0, NaN, true);
  expect(() =>
    directStaticMeshSceneOmissions(requirements(), nonfinite),
  ).toThrow("Nonfinite");
  for (const size of [0, 16, 207, 209]) {
    const short = scene();
    short.dataBuffers.ParticleMeshInstanceInfo_SharedDataBuffer.bytes =
      new Uint8Array(size);
    expect(() => directStaticMeshSceneOmissions(requirements(), short)).toThrow(
      "208-byte",
    );
  }
  const noProvenance = scene();
  delete noProvenance.dataBuffers.ParticleMeshInstanceInfo_SharedDataBuffer
    .inputPolicy;
  expect(() =>
    directStaticMeshSceneOmissions(requirements(), noProvenance),
  ).toThrow("208-byte");
  const sparse = scene();
  sparse.blendColor = Array(4);
  expect(() => directStaticMeshSceneOmissions(requirements(), sparse)).toThrow(
    "blend color",
  );
});
