import { describe, test, expect } from "bun:test";
import {
  StringSchema,
  ActualNumberSchema,
  ActualBooleanSchema,
  NullSchema,
  UndefinedSchema,
  ArraySchema,
  RecordSchema,
  StringBooleanSchema,
  HelmValueSchema,
} from "./schemas";

describe("Schema Validation - StringSchema", () => {
  test("should validate strings", () => {
    expect(StringSchema.safeParse("hello").success).toBe(true);
    expect(StringSchema.safeParse("").success).toBe(true);
  });

  test("should reject non-strings", () => {
    expect(StringSchema.safeParse(123).success).toBe(false);
    expect(StringSchema.safeParse(true).success).toBe(false);
    expect(StringSchema.safeParse(null).success).toBe(false);
  });
});

describe("Schema Validation - ActualNumberSchema", () => {
  test("should validate numbers", () => {
    expect(ActualNumberSchema.safeParse(123).success).toBe(true);
    expect(ActualNumberSchema.safeParse(0).success).toBe(true);
    expect(ActualNumberSchema.safeParse(-456).success).toBe(true);
    expect(ActualNumberSchema.safeParse(3.14).success).toBe(true);
  });

  test("should reject non-numbers", () => {
    expect(ActualNumberSchema.safeParse("123").success).toBe(false);
    expect(ActualNumberSchema.safeParse(true).success).toBe(false);
    expect(ActualNumberSchema.safeParse(null).success).toBe(false);
  });
});

describe("Schema Validation - ActualBooleanSchema", () => {
  test("should validate booleans", () => {
    expect(ActualBooleanSchema.safeParse(true).success).toBe(true);
    expect(ActualBooleanSchema.safeParse(false).success).toBe(true);
  });

  test("should reject non-booleans", () => {
    expect(ActualBooleanSchema.safeParse("true").success).toBe(false);
    expect(ActualBooleanSchema.safeParse(1).success).toBe(false);
    expect(ActualBooleanSchema.safeParse(null).success).toBe(false);
  });
});

describe("Schema Validation - StringBooleanSchema", () => {
  test("should validate boolean-like strings", () => {
    expect(StringBooleanSchema.safeParse("true").success).toBe(true);
    expect(StringBooleanSchema.safeParse("false").success).toBe(true);
    expect(StringBooleanSchema.safeParse("TRUE").success).toBe(true);
    expect(StringBooleanSchema.safeParse("FALSE").success).toBe(true);
    expect(StringBooleanSchema.safeParse("yes").success).toBe(true);
    expect(StringBooleanSchema.safeParse("no").success).toBe(true);
    expect(StringBooleanSchema.safeParse("YES").success).toBe(true);
    expect(StringBooleanSchema.safeParse("NO").success).toBe(true);
  });

  test("should reject non-boolean strings", () => {
    expect(StringBooleanSchema.safeParse("hello").success).toBe(false);
    expect(StringBooleanSchema.safeParse("1").success).toBe(false);
    expect(StringBooleanSchema.safeParse("").success).toBe(false);
  });

  test("should reject actual booleans", () => {
    expect(StringBooleanSchema.safeParse(true).success).toBe(false);
    expect(StringBooleanSchema.safeParse(false).success).toBe(false);
  });
});

describe("Schema Validation - NullSchema", () => {
  test("should validate null", () => {
    expect(NullSchema.safeParse(null).success).toBe(true);
  });

  test("should reject non-null", () => {
    expect(NullSchema.safeParse(undefined).success).toBe(false);
    expect(NullSchema.safeParse("").success).toBe(false);
    expect(NullSchema.safeParse(0).success).toBe(false);
  });
});

describe("Schema Validation - UndefinedSchema", () => {
  test("should validate undefined", () => {
    expect(UndefinedSchema.safeParse(undefined).success).toBe(true);
  });

  test("should reject non-undefined", () => {
    expect(UndefinedSchema.safeParse(null).success).toBe(false);
    expect(UndefinedSchema.safeParse("").success).toBe(false);
  });
});

describe("Schema Validation - ArraySchema", () => {
  test("should validate arrays", () => {
    expect(ArraySchema.safeParse([]).success).toBe(true);
    expect(ArraySchema.safeParse([1, 2, 3]).success).toBe(true);
    expect(ArraySchema.safeParse(["a", "b"]).success).toBe(true);
  });

  test("should reject non-arrays", () => {
    expect(ArraySchema.safeParse("array").success).toBe(false);
    expect(ArraySchema.safeParse({}).success).toBe(false);
    expect(ArraySchema.safeParse(null).success).toBe(false);
  });
});

describe("Schema Validation - RecordSchema", () => {
  test("should validate objects", () => {
    expect(RecordSchema.safeParse({}).success).toBe(true);
    expect(RecordSchema.safeParse({ key: "value" }).success).toBe(true);
    expect(RecordSchema.safeParse({ a: 1, b: 2 }).success).toBe(true);
  });

  test("should reject non-objects", () => {
    expect(RecordSchema.safeParse([]).success).toBe(false);
    expect(RecordSchema.safeParse("object").success).toBe(false);
    expect(RecordSchema.safeParse(null).success).toBe(false);
  });
});

describe("Schema Validation - HelmValueSchema", () => {
  test("should validate nested Helm values", () => {
    expect(
      HelmValueSchema.safeParse({
        string: "value",
        number: 123,
        boolean: true,
        nested: {
          deep: "value",
        },
      }).success,
    ).toBe(true);
  });

  test("should allow arrays in values", () => {
    expect(
      HelmValueSchema.safeParse({
        items: [1, 2, 3],
      }).success,
    ).toBe(true);
  });

  test("should allow null and undefined", () => {
    expect(
      HelmValueSchema.safeParse({
        nullable: null,
        optional: undefined,
      }).success,
    ).toBe(true);
  });
});
