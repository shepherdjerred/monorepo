import { describe, test, expect } from "bun:test";
import {
  jsonSchemaToTypeScript,
  inferTypeFromValue,
  typesAreCompatible,
  convertToTypeScriptInterface,
} from "./type-inference";
import type { JSONSchemaProperty } from "./types";

describe("JSON Schema to TypeScript Type Conversion", () => {
  test("should convert basic types", () => {
    expect(jsonSchemaToTypeScript({ type: "string" })).toBe("string");
    expect(jsonSchemaToTypeScript({ type: "number" })).toBe("number");
    expect(jsonSchemaToTypeScript({ type: "integer" })).toBe("number");
    expect(jsonSchemaToTypeScript({ type: "boolean" })).toBe("boolean");
    expect(jsonSchemaToTypeScript({ type: "object" })).toBe("object");
    expect(jsonSchemaToTypeScript({ type: "array" })).toBe("unknown[]");
    expect(jsonSchemaToTypeScript({ type: "null" })).toBe("null");
  });

  test("should handle oneOf unions", () => {
    const schema: JSONSchemaProperty = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };
    expect(jsonSchemaToTypeScript(schema)).toBe("string | number");
  });

  test("should handle anyOf unions", () => {
    const schema: JSONSchemaProperty = {
      anyOf: [{ type: "boolean" }, { type: "string" }],
    };
    expect(jsonSchemaToTypeScript(schema)).toBe("boolean | string");
  });

  test("should handle array types with items", () => {
    const schema: JSONSchemaProperty = {
      type: "array",
      items: { type: "string" },
    };
    expect(jsonSchemaToTypeScript(schema)).toBe("string[]");
  });

  test("should handle enum types", () => {
    const schema: JSONSchemaProperty = {
      enum: ["option1", "option2", "option3"],
    };
    expect(jsonSchemaToTypeScript(schema)).toBe('"option1" | "option2" | "option3"');
  });

  test("should handle multiple types", () => {
    const schema: JSONSchemaProperty = {
      type: ["string", "number"],
    };
    expect(jsonSchemaToTypeScript(schema)).toBe("string | number");
  });
});

describe("Type Inference from Values", () => {
  test("should infer boolean from actual boolean", () => {
    expect(inferTypeFromValue(true)).toBe("boolean");
    expect(inferTypeFromValue(false)).toBe("boolean");
  });

  test("should infer number from actual number", () => {
    expect(inferTypeFromValue(123)).toBe("number");
    expect(inferTypeFromValue(0)).toBe("number");
    expect(inferTypeFromValue(-456)).toBe("number");
    expect(inferTypeFromValue(3.14)).toBe("number");
  });

  test("should infer boolean from string boolean", () => {
    expect(inferTypeFromValue("true")).toBe("boolean");
    expect(inferTypeFromValue("false")).toBe("boolean");
    expect(inferTypeFromValue("yes")).toBe("boolean");
    expect(inferTypeFromValue("no")).toBe("boolean");
  });

  test("should infer number from numeric string", () => {
    expect(inferTypeFromValue("123")).toBe("number");
    expect(inferTypeFromValue("0")).toBe("number");
    expect(inferTypeFromValue("3.14")).toBe("number");
  });

  test("should infer string from plain string", () => {
    expect(inferTypeFromValue("hello")).toBe("string");
    expect(inferTypeFromValue("world")).toBe("string");
  });

  test("should infer array from arrays", () => {
    expect(inferTypeFromValue([])).toBe("array");
    expect(inferTypeFromValue([1, 2, 3])).toBe("array");
  });

  test("should infer object from objects", () => {
    expect(inferTypeFromValue({})).toBe("object");
    expect(inferTypeFromValue({ key: "value" })).toBe("object");
  });

  test("should return null for null/undefined", () => {
    expect(inferTypeFromValue(null)).toBe(null);
    expect(inferTypeFromValue(undefined)).toBe(null);
  });
});

describe("Type Compatibility", () => {
  test("should accept exact matches", () => {
    expect(typesAreCompatible("string", "string")).toBe(true);
    expect(typesAreCompatible("number", "number")).toBe(true);
    expect(typesAreCompatible("boolean", "boolean")).toBe(true);
  });

  test("should handle union types", () => {
    expect(typesAreCompatible("string", "string | number")).toBe(true);
    expect(typesAreCompatible("number", "string | number")).toBe(true);
  });

  test("should handle array types", () => {
    expect(typesAreCompatible("array", "string[]")).toBe(true);
    expect(typesAreCompatible("array", "number[]")).toBe(true);
  });

  test("should handle string literals", () => {
    expect(typesAreCompatible("string", '"default"')).toBe(true);
    expect(typesAreCompatible("string", '"option1" | "option2"')).toBe(true);
  });

  test("should accept unknown as compatible with everything", () => {
    expect(typesAreCompatible("unknown", "string")).toBe(true);
    expect(typesAreCompatible("string", "unknown")).toBe(true);
  });

  test("should reject incompatible types", () => {
    expect(typesAreCompatible("string", "number")).toBe(false);
    expect(typesAreCompatible("boolean", "string")).toBe(false);
  });
});

describe("Convert to TypeScript Interface", () => {
  test("should convert simple object", () => {
    const values = {
      name: "test",
      count: 42,
      enabled: true,
    };

    const result = convertToTypeScriptInterface(values, "TestInterface");

    expect(result.name).toBe("TestInterface");
    expect(result.properties["name"]?.type).toBe("string");
    expect(result.properties["count"]?.type).toBe("number");
    expect(result.properties["enabled"]?.type).toBe("boolean");
  });

  test("should handle nested objects", () => {
    const values = {
      config: {
        nested: "value",
      },
    };

    const result = convertToTypeScriptInterface(values, "TestInterface");

    expect(result.properties["config"]?.nested).toBeDefined();
    expect(result.properties["config"]?.nested?.name).toBe("TestInterfaceConfig");
  });

  test("should handle arrays", () => {
    const values = {
      items: [1, 2, 3],
    };

    const result = convertToTypeScriptInterface(values, "TestInterface");

    expect(result.properties["items"]?.type).toBe("number[]");
  });

  test("should handle empty arrays", () => {
    const values = {
      items: [],
    };

    const result = convertToTypeScriptInterface(values, "TestInterface");

    expect(result.properties["items"]?.type).toBe("unknown[]");
  });

  test("should use schema when provided", () => {
    const values = {
      port: "8080", // String value
    };

    const schema: JSONSchemaProperty = {
      properties: {
        port: {
          type: "number", // Schema says it's a number
        },
      },
    };

    const result = convertToTypeScriptInterface(values, "TestInterface", schema);

    expect(result.properties["port"]?.type).toBe("number");
  });

  test("should include YAML comments", () => {
    const values = {
      key: "value",
    };

    const comments = new Map([["key", "This is a comment"]]);

    const result = convertToTypeScriptInterface(values, "TestInterface", undefined, comments);

    expect(result.properties["key"]?.description).toBe("This is a comment");
  });

  test("should handle special property names", () => {
    const values = {
      "my-property": "value",
      default: "value",
      "123key": "value",
    };

    const result = convertToTypeScriptInterface(values, "TestInterface");

    expect(result.properties['"my-property"']).toBeDefined();
    expect(result.properties['"default"']).toBeDefined();
    expect(result.properties['"123key"']).toBeDefined();
  });
});
