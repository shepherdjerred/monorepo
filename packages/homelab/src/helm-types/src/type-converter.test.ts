import { describe, test, expect } from "bun:test";
import { convertToTypeScriptInterface } from "./type-converter.js";
import type { JSONSchemaProperty } from "./types.js";

describe("JSON Schema to TypeScript Type Conversion", () => {
  test("should convert basic types", () => {
    const stringSchema: JSONSchemaProperty = { type: "string" };
    const numberSchema: JSONSchemaProperty = { type: "number" };
    const booleanSchema: JSONSchemaProperty = { type: "boolean" };

    const values = {
      str: "test",
      num: 42,
      bool: true,
    };

    const result = convertToTypeScriptInterface(values, "TestValues", {
      properties: {
        str: stringSchema,
        num: numberSchema,
        bool: booleanSchema,
      },
    });

    expect(result.properties["str"]?.type).toBe("string");
    expect(result.properties["num"]?.type).toBe("number");
    expect(result.properties["bool"]?.type).toBe("boolean");
  });

  test("should handle oneOf unions", () => {
    const schema: JSONSchemaProperty = {
      oneOf: [{ type: "integer" }, { enum: ["default"] }],
    };

    const values = { setting: "default" };

    const result = convertToTypeScriptInterface(values, "TestValues", {
      properties: { setting: schema },
    });

    expect(result.properties["setting"]?.type).toBe('number | "default"');
  });

  test("should handle anyOf unions", () => {
    const schema: JSONSchemaProperty = {
      anyOf: [{ type: "string", enum: ["default"] }, { type: "boolean" }],
    };

    const values = { setting: "default" };

    const result = convertToTypeScriptInterface(values, "TestValues", {
      properties: { setting: schema },
    });

    expect(result.properties["setting"]?.type).toBe('"default" | boolean');
  });

  test("should handle array types", () => {
    const schema: JSONSchemaProperty = {
      type: "array",
      items: { type: "string" },
    };

    const values = { list: ["a", "b", "c"] };

    const result = convertToTypeScriptInterface(values, "TestValues", {
      properties: { list: schema },
    });

    expect(result.properties["list"]?.type).toBe("string[]");
  });
});

describe("Type Inference from Values", () => {
  test("should infer boolean from actual boolean", () => {
    const values = { flag: true };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["flag"]?.type).toBe("boolean");
  });

  test("should infer number from actual number", () => {
    const values = { count: 42 };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["count"]?.type).toBe("number");
  });

  test("should infer boolean from string boolean", () => {
    const values = { flag: "FALSE" };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["flag"]?.type).toBe("boolean");
  });

  test("should infer number from numeric string", () => {
    const values = { port: "8080" };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["port"]?.type).toBe("number");
  });

  test('should handle "default" as union type', () => {
    const values = { setting: "default" };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["setting"]?.type).toBe("string | number | boolean");
  });

  test("should infer plain string", () => {
    const values = { name: "test" };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["name"]?.type).toBe("string");
  });

  test("should handle empty string", () => {
    const values = { empty: "" };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["empty"]?.type).toBe("string");
  });

  test("should handle empty object", () => {
    const values = { obj: {} };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["obj"]?.type).toBe("TestValuesObj");
    expect(result.properties["obj"]?.nested).toBeDefined();
  });

  test("should handle empty array", () => {
    const values = { arr: [] };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["arr"]?.type).toBe("unknown[]");
  });
});

describe("Description and Default Value Handling", () => {
  test("should include schema description", () => {
    const schema: JSONSchemaProperty = {
      properties: {
        setting: {
          type: "string",
          description: "This is a test setting",
        },
      },
    };

    const values = { setting: "value" };

    const result = convertToTypeScriptInterface(values, "TestValues", schema);

    expect(result.properties["setting"]?.description).toBe("This is a test setting");
  });

  test("should include schema default", () => {
    const schema: JSONSchemaProperty = {
      properties: {
        setting: {
          type: "string",
          default: "default-value",
        },
      },
    };

    const values = { setting: "value" };

    const result = convertToTypeScriptInterface(values, "TestValues", schema);

    expect(result.properties["setting"]?.default).toBe("default-value");
  });

  test("should merge YAML comments with schema description", () => {
    const schema: JSONSchemaProperty = {
      properties: {
        setting: {
          type: "string",
          description: "Schema description",
        },
      },
    };

    const yamlComments = new Map([["setting", "YAML comment"]]);
    const values = { setting: "value" };

    const result = convertToTypeScriptInterface(values, "TestValues", schema, yamlComments);

    expect(result.properties["setting"]?.description).toContain("YAML comment");
    expect(result.properties["setting"]?.description).toContain("Schema description");
  });

  test("should use YAML comment when no schema description", () => {
    const schema: JSONSchemaProperty = {
      properties: {
        setting: { type: "string" },
      },
    };

    const yamlComments = new Map([["setting", "YAML comment only"]]);
    const values = { setting: "value" };

    const result = convertToTypeScriptInterface(values, "TestValues", schema, yamlComments);

    expect(result.properties["setting"]?.description).toBe("YAML comment only");
  });
});

describe("Nested Objects", () => {
  test("should handle nested objects with schema", () => {
    const schema: JSONSchemaProperty = {
      properties: {
        parent: {
          type: "object",
          properties: {
            child: {
              type: "string",
              description: "Nested description",
            },
          },
        },
      },
    };

    const values = {
      parent: {
        child: "value",
      },
    };

    const result = convertToTypeScriptInterface(values, "TestValues", schema);

    expect(result.properties["parent"]?.type).toBe("TestValuesParent");
    expect(result.properties["parent"]?.nested).toBeDefined();
    expect(result.properties["parent"]?.nested?.properties["child"]?.type).toBe("string");
    expect(result.properties["parent"]?.nested?.properties["child"]?.description).toBe("Nested description");
  });

  test("should handle deeply nested objects", () => {
    const values = {
      level1: {
        level2: {
          level3: {
            value: "deep",
          },
        },
      },
    };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["level1"]?.nested).toBeDefined();
    expect(result.properties["level1"]?.nested?.properties["level2"]?.nested).toBeDefined();
  });
});

describe("Edge Cases", () => {
  test("should handle null values", () => {
    const values = { nullable: null };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["nullable"]?.type).toBe("unknown");
  });

  test("should handle undefined values", () => {
    const values = { undef: undefined };

    const result = convertToTypeScriptInterface(values, "TestValues");

    // undefined is treated as unknown type
    expect(result.properties["undef"]?.type).toBe("unknown");
  });

  test("should handle mixed array types", () => {
    const values = { mixed: [1, "two", true] };

    const result = convertToTypeScriptInterface(values, "TestValues");

    // Should create a union type or unknown[]
    expect(result.properties["mixed"]?.type).toBeTruthy();
  });

  test("should handle object array", () => {
    const values = {
      objArr: [
        { name: "a", value: 1 },
        { name: "b", value: 2 },
      ],
    };

    const result = convertToTypeScriptInterface(values, "TestValues");

    expect(result.properties["objArr"]?.type).toContain("[]");
  });
});
