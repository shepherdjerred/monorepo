import { describe, expect, test } from "bun:test";
import { caseInsensitiveEnum, clampedInt } from "./schema-helpers.ts";

describe("clampedInt", () => {
  const schema = clampedInt(1, 20);

  test("passes in-range values through unchanged", () => {
    expect(schema.parse(1)).toBe(1);
    expect(schema.parse(12)).toBe(12);
    expect(schema.parse(20)).toBe(20);
  });

  test("clamps values above the max down to the max", () => {
    expect(schema.parse(21)).toBe(20);
    expect(schema.parse(999)).toBe(20);
  });

  test("clamps values below the min up to the min", () => {
    expect(schema.parse(0)).toBe(1);
    expect(schema.parse(-5)).toBe(1);
  });

  test("still rejects non-integers and wrong types", () => {
    expect(() => schema.parse(2.5)).toThrow();
    expect(() => schema.parse("12")).toThrow();
    expect(() => schema.parse(null)).toThrow();
    expect(() => schema.parse(undefined)).toThrow();
  });

  test("composes with .default() for omitted values", () => {
    const withDefault = clampedInt(1, 200).default(64);
    expect(withDefault.parse(undefined)).toBe(64);
    expect(withDefault.parse(500)).toBe(200);
  });
});

describe("caseInsensitiveEnum", () => {
  const schema = caseInsensitiveEnum(["north", "south", "west", "east"]);

  test("accepts canonical lowercase values", () => {
    expect(schema.parse("north")).toBe("north");
  });

  test("normalizes any casing and surrounding whitespace", () => {
    expect(schema.parse("North")).toBe("north");
    expect(schema.parse("SOUTH")).toBe("south");
    expect(schema.parse(" EAST ")).toBe("east");
  });

  test("rejects values outside the enum", () => {
    expect(() => schema.parse("up")).toThrow();
    expect(() => schema.parse("northward")).toThrow();
    expect(() => schema.parse(3)).toThrow();
  });
});
