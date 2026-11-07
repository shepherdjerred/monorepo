import { test, expect } from "bun:test";
import {
  replaySamplerUniforms,
  assertReplaySamplerUniforms,
} from "./latest-renderer-samplers.mjs";
const resource = (name, aliases, dimension = "texture2d") => ({
  name,
  dimension,
  samplers: aliases.map((glslName) => ({ glslName })),
});
const formats = { integerFormats: [2], unsignedTypes: [3] },
  raw = {
    isRawShaderMaterial: true,
    name: "source-owned-material",
    uuid: "material-id",
    userData: { replayMaterial: { materialKey: "source:4" } },
  },
  linked = { id: 12 },
  floatTexture = () => ({ isTexture: true, format: 1, type: 3 }),
  uintTexture = () => ({ isTexture: true, format: 2, type: 3 }),
  floatUniform = { id: "T", type: 0x8b5e },
  uintUniform = { id: "B", type: 0x8dd2 };
const check = (seq, values, required = true, material = raw) =>
  assertReplaySamplerUniforms(seq, values, material, linked, formats, required);
test("pending declared samplers compile while actual upload requires current typed resources", () => {
  const values = { T: { value: null }, B: { value: uintTexture() } };
  expect(() => check([floatUniform, uintUniform], values, false)).not.toThrow();
  expect(() => check([floatUniform, uintUniform], values)).toThrow(
    "current texture",
  );
  values.T.value = floatTexture();
  expect(() => check([floatUniform, uintUniform], values)).not.toThrow();
  values.T.value = null;
  expect(() => check([floatUniform, uintUniform], values)).toThrow(
    "material-id",
  );
  for (const values of [
    {},
    { T: undefined },
    { T: {} },
    { T: { value: floatTexture(), needsUpdate: false } },
    { T: { value: uintTexture() } },
    { B: { value: floatTexture() } },
  ])
    expect(() =>
      check(
        Object.hasOwn(values, "B") ? [uintUniform] : [floatUniform],
        values,
      ),
    ).toThrow();
  expect(() =>
    check([floatUniform], {
      T: { value: { ...floatTexture(), isCubeTexture: true } },
    }),
  ).toThrow("2D texture");
  expect(() =>
    check([{ id: "C", type: 0x8b60 }], { C: { value: null } }, false),
  ).toThrow("no admitted");
});
test("sampler array and nested structure shape are explicit; non-samplers remain unaffected", () => {
  const nested = {
      id: "group",
      seq: [{ id: "textures", type: 0x8b5e, size: 2 }],
    },
    values = {
      group: { value: { textures: [floatTexture(), floatTexture()] } },
    };
  expect(() => check([nested], values)).not.toThrow();
  values.group.value.textures.pop();
  expect(() => check([nested], values)).toThrow("array shape");
  delete values.group.value.textures;
  expect(() => check([nested], values)).toThrow("own sampler data");
  expect(() => check([], {})).not.toThrow();
  expect(() => check([{ id: "number", type: 0x1406 }], {})).not.toThrow();
  expect(() =>
    check([floatUniform], {}, true, { isRawShaderMaterial: false }),
  ).not.toThrow();
  expect(() =>
    check([floatUniform], Object.create({ T: { value: floatTexture() } })),
  ).toThrow();
  let called = 0;
  const getter = {
    T: {
      get value() {
        called++;
        return floatTexture();
      },
    },
  };
  expect(() => check([floatUniform], getter)).toThrow();
  expect(called).toBe(0);
});
const stages = (items) => [{ sidecar: { textures: items } }];
test("native semantic names bind all exact GLSL aliases and integer buffer declaration", () => {
  const texture = { isTexture: true },
    buffer = { isTexture: true },
    resources = new Map([
      ["TEXTURE__TX", texture],
      ["SharedBuffer", buffer],
    ]),
    fields = [
      resource("TEXTURE__TX", ["TEXTURE_TX", "TEXTURE_SecondarySampler"]),
      resource("SharedBuffer", [], "buffer"),
    ],
    uniforms = replaySamplerUniforms(
      [...stages(fields), ...stages(fields)],
      resources,
    );
  expect(Object.keys(uniforms)).toEqual([
    "TEXTURE_TX",
    "TEXTURE_SecondarySampler",
    "SharedBuffer",
  ]);
  expect(uniforms.TEXTURE_TX.value).toBe(texture);
  expect(uniforms.TEXTURE_SecondarySampler.value).toBe(texture);
  expect(uniforms.SharedBuffer.value).toBe(buffer);
  expect(Object.hasOwn(uniforms, "TEXTURE__TX")).toBe(false);
});
test("sampler closure rejects missing resources, absent aliases and conflicting source identities", () => {
  const texture = { isTexture: true },
    resources = new Map([["a", texture]]);
  for (const [s, r] of [
    [stages([resource("missing", ["actual"])]), resources],
    [stages([resource("a", [])]), resources],
    [
      stages([resource("a", ["actual"])]),
      new Map([...resources, ["unused", texture]]),
    ],
    [
      stages([resource("a", ["same"]), resource("b", ["same"])]),
      new Map([
        ["a", texture],
        ["b", texture],
      ]),
    ],
    [stages([resource("a", ["invalid-name"])]), resources],
    [stages([resource("a", ["actual"])]), new Map([["a", {}]])],
  ])
    expect(() => replaySamplerUniforms(s, r)).toThrow();
});
