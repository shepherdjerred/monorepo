import { expect, test } from "vitest";
import { JsonPathSchema, selectJsonValues } from "./json-selection.ts";

test("expands ordered arrays, preserving explicit null separately from absent fields", () => {
  const result = selectJsonValues(
    [{ value: 3 }, { value: null }, {}],
    [{ arrayElements: true }, "value"],
  );
  expect(
    result.map(({ present, value, type }) => ({ present, value, type })),
  ).toEqual([
    { present: true, value: 3, type: "number" },
    { present: true, value: null, type: "null" },
    { present: false, value: null, type: "missing" },
  ]);
});
test("does not read inherited properties or evaluate path text", () => {
  expect(selectJsonValues({}, ["constructor"])[0]?.present).toBe(false);
  expect(selectJsonValues({}, ["process.env"])[0]?.present).toBe(false);
  expect(
    JsonPathSchema.safeParse([
      { expression: "fetch('https://example.invalid')" },
    ]).success,
  ).toBe(false);
});
