import { describe, test, expect } from "bun:test";
import { generateTypeScriptCode } from "./code-generator";
import type { TypeScriptInterface } from "./types";

describe("Code Generation", () => {
  test("should generate basic interface", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        name: { type: "string", optional: true },
        count: { type: "number", optional: true },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("export type TestInterface = {");
    expect(code).toContain("name?: string;");
    expect(code).toContain("count?: number;");
    expect(code).toContain("export type TestchartHelmParameters");
  });

  test("should generate JSDoc comments", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        name: {
          type: "string",
          optional: true,
          description: "The name property",
          default: "default-name",
        },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("/**");
    expect(code).toContain("* The name property");
    expect(code).toContain("* @default");
    expect(code).toContain('"default-name"');
    expect(code).toContain("*/");
  });

  test("should handle properties without description", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        simple: { type: "string", optional: true },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("simple?: string;");
    expect(code).not.toContain("/**");
  });

  test("should format default values correctly", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        str: { type: "string", optional: true, default: "hello" },
        num: { type: "number", optional: true, default: 42 },
        bool: { type: "boolean", optional: true, default: true },
        nil: { type: "unknown", optional: true, default: null },
        arr: { type: "string[]", optional: true, default: ["a", "b"] },
        obj: { type: "object", optional: true, default: { key: "value" } },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain('@default "hello"');
    expect(code).toContain("@default 42");
    expect(code).toContain("@default true");
    expect(code).toContain("@default null");
    expect(code).toContain('@default ["a","b"]');
    expect(code).toContain('@default {"key":"value"}');
  });

  test("should truncate long default values", () => {
    const longString = "a".repeat(100);
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        long: { type: "string", optional: true, default: longString },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("@default");
    expect(code).toContain("...");
    expect(code.length).toBeLessThan(longString.length + 200);
  });

  test("should summarize large objects/arrays", () => {
    const largeArray = Array.from({ length: 100 }, (_, i) => i);
    const largeObject = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${String(i)}`, i]));

    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        arr: { type: "number[]", optional: true, default: largeArray },
        obj: { type: "object", optional: true, default: largeObject },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("@default [...] (100 items)");
    expect(code).toContain("@default {...} (100 keys)");
  });

  test("should escape */ sequences in JSDoc comments", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        field: {
          type: "string",
          optional: true,
          description: "This is a comment with */ in it",
        },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("*\\/");
    expect(code).not.toContain("This is a comment with */");
  });

  test("should handle nested interfaces", () => {
    const iface: TypeScriptInterface = {
      name: "ParentInterface",
      properties: {
        nested: {
          type: "NestedInterface",
          optional: true,
          nested: {
            name: "NestedInterface",
            properties: {
              value: { type: "string", optional: true },
            },
          },
        },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("export type NestedInterface = {");
    expect(code).toContain("value?: string;");
    expect(code).toContain("export type ParentInterface = {");
    expect(code).toContain("nested?: NestedInterface;");
  });

  test("should generate parameter type with flattened keys", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        top: { type: "string", optional: true },
        nested: {
          type: "NestedInterface",
          optional: true,
          nested: {
            name: "NestedInterface",
            properties: {
              deep: { type: "string", optional: true },
            },
          },
        },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("export type TestchartHelmParameters = {");
    expect(code).toContain('"top"?: string;');
    expect(code).toContain('"nested.deep"?: string;');
  });

  test("should handle empty interface", () => {
    const iface: TypeScriptInterface = {
      name: "EmptyInterface",
      properties: {},
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("export type EmptyInterface = object;");
  });

  test("should add eslint disable for any types", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        field: { type: "any", optional: true },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("/* eslint-disable @typescript-eslint/no-explicit-any */");
  });

  test("should normalize chart names with hyphens", () => {
    const iface: TypeScriptInterface = {
      name: "ArgocdInterface",
      properties: {
        value: { type: "string", optional: true },
      },
    };

    const code = generateTypeScriptCode(iface, "argo-cd");

    expect(code).toContain("export type ArgocdHelmParameters");
  });

  test("should handle multi-line descriptions", () => {
    const iface: TypeScriptInterface = {
      name: "TestInterface",
      properties: {
        field: {
          type: "string",
          optional: true,
          description: "Line 1\nLine 2\nLine 3",
        },
      },
    };

    const code = generateTypeScriptCode(iface, "test-chart");

    expect(code).toContain("* Line 1");
    expect(code).toContain("* Line 2");
    expect(code).toContain("* Line 3");
  });
});
