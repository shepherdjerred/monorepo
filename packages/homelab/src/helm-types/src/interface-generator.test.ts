import { describe, test, expect } from "bun:test";
import { generateTypeScriptCode } from "./interface-generator.js";
import type { TypeScriptInterface } from "./types.js";

describe("Code Generation", () => {
  test("should generate JSDoc comments", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        setting: {
          type: "string",
          optional: true,
          description: "Test description",
          default: "test-default",
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain("/**");
    expect(code).toContain("Test description");
    expect(code).toContain("@default");
    expect(code).toContain('"test-default"');
  });

  test("should handle properties without description", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        setting: {
          type: "string",
          optional: true,
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain("setting?: string;");
    expect(code).not.toContain("/**");
  });

  test("should format default values correctly", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        str: { type: "string", optional: true, default: "test" },
        num: { type: "number", optional: true, default: 42 },
        bool: { type: "boolean", optional: true, default: true },
        arr: { type: "array", optional: true, default: ["a", "b"] },
        obj: { type: "object", optional: true, default: { key: "value" } },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain('@default "test"');
    expect(code).toContain("@default 42");
    expect(code).toContain("@default true");
    expect(code).toContain('@default ["a","b"]');
    expect(code).toContain('@default {"key":"value"}');
  });

  test("should truncate long default values", () => {
    const longString = "a".repeat(100);
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        long: { type: "string", optional: true, default: longString },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain("@default");
    expect(code).toContain("...");
  });

  test("should summarize large objects/arrays", () => {
    const largeObj = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`key${String(i)}`, i]));
    const largeArr = Array.from({ length: 100 }, (_, i) => i);

    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        obj: { type: "object", optional: true, default: largeObj },
        arr: { type: "array", optional: true, default: largeArr },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain("{...}");
    expect(code).toContain("[...]");
    expect(code).toContain("keys");
    expect(code).toContain("items");
  });

  test("should escape */ sequences in JSDoc comments", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        policy: {
          type: "string",
          optional: true,
          description: "Policy rules: p, role:org-admin, applications, *, */*, allow",
          default: "",
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    // Should escape */ to *\/ to prevent premature comment closure
    expect(code).toContain("*\\/");
    // Should still be valid TypeScript (not prematurely closing the comment)
    expect(code).toContain("policy?: string;");
    // Should not have unescaped */
    expect(code).not.toContain("*, */*, allow");
  });

  test("should escape multiple */ sequences in description", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        rules: {
          type: "string",
          optional: true,
          description: "Multiple patterns: */*, */*/*.js, and */test/* should all be escaped",
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    // All */ should be escaped (4 total: */, */, */, */)
    const escapedCount = (code.match(/\*\\\//g) ?? []).length;
    expect(escapedCount).toBe(4); // Four */ sequences in the description

    // Should still be valid TypeScript
    expect(code).toContain("rules?: string;");
  });

  test("should handle */ in multi-line descriptions", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        config: {
          type: "string",
          optional: true,
          description: "Line 1 with */\nLine 2 also with */*, test\nLine 3 normal",
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    // Should escape all */ sequences
    expect(code).toContain("*\\/");
    // Should maintain line structure
    expect(code).toContain("Line 1");
    expect(code).toContain("Line 2");
    expect(code).toContain("Line 3 normal");
    // Should still be valid TypeScript
    expect(code).toContain("config?: string;");
  });
});

describe("Parameter Type Generation", () => {
  test("should generate flattened parameter type", () => {
    const tsInterface: TypeScriptInterface = {
      name: "TestValues",
      properties: {
        parent: {
          type: "TestValuesParent",
          optional: true,
          nested: {
            name: "TestValuesParent",
            properties: {
              child: {
                type: "string",
                optional: true,
              },
            },
          },
        },
      },
    };

    const code = generateTypeScriptCode(tsInterface, "test");

    expect(code).toContain("TestHelmParameters");
    expect(code).toContain('"parent.child"?');
  });
});
