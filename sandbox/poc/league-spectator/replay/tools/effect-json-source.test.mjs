import { expect, test } from "bun:test";
import { restoreEffectJsonSource } from "./effect-json-source.mjs";

const original = { __type: "VfxSystemDefinitionData", offset: [-0, 1, -2] };
const source = (definition = original, path = "a.bin") => ({
  path,
  data: { "{12345678}": definition },
});
const prepared = () => ({
  id: "12345678",
  sourceBins: ["a.bin"],
  definition: { __type: "VfxSystemDefinitionData", offset: [0, 1, -2] },
});

test("restoration retains original zero signs and independent source ownership", () => {
  const p = prepared();
  const result = restoreEffectJsonSource(p, [source()]);
  expect(result.restored).toEqual([
    { path: "/offset/0", originalNegative: true },
  ]);
  expect(result.counts.numbers).toBe(3);
  expect(Object.is(result.definition.offset[0], -0)).toBe(true);
  expect(Object.is(p.definition.offset[0], 0)).toBe(true);
  result.definition.offset[1] = 7;
  expect(original.offset[1]).toBe(1);
});

test("unchanged source bits remain unchanged", () => {
  const p = prepared();
  p.definition = structuredClone(original);
  expect(restoreEffectJsonSource(p, [source()]).restored).toEqual([]);
});

test("missing, duplicate and unrelated source inventories fail", () => {
  for (const sources of [
    [],
    [source(original, "other.bin")],
    [source(), source()],
    [{ path: "a.bin", data: {} }],
  ])
    expect(() => restoreEffectJsonSource(prepared(), sources)).toThrow();
});

test("only zero-sign differences can be migrated", () => {
  for (const definition of [
    { ...original, offset: [-0, 2, -2] },
    { ...original, offset: [-0, 1] },
    { ...original, offset: [-0, 1, NaN] },
    { ...original, extra: true },
  ])
    expect(() =>
      restoreEffectJsonSource(prepared(), [source(definition)]),
    ).toThrow();
});

test("ambiguous original zero signs cannot inherit old JSON's collapsed equality", () => {
  const p = prepared();
  p.sourceBins.push("b.bin");
  expect(() =>
    restoreEffectJsonSource(p, [source(), source(p.definition, "b.bin")]),
  ).toThrow("sources disagree");
  expect(
    restoreEffectJsonSource(p, [source(), source(original, "b.bin")]).restored,
  ).toHaveLength(1);
});
