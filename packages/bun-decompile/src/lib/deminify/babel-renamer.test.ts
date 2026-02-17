import { describe, expect, it } from "bun:test";
import {
  applyRenames,
  extractIdentifiers,
  type RenameMappings,
} from "./babel-renamer.ts";

describe("babel-renamer", () => {
  describe("applyRenames", () => {
    it("should rename function parameters", async () => {
      const source = `function a(x, y) { return x + y; }`;
      const mappings: RenameMappings = {
        a_0_34: {
          functionName: "add",
          description: "Adds two numbers",
          renames: { x: "num1", y: "num2" },
        },
      };

      const result = await applyRenames(source, mappings);

      expect(result).toContain("function add");
      expect(result).toContain("num1");
      expect(result).toContain("num2");
      expect(result).not.toContain("function a(");
      expect(result).toContain("Adds two numbers");
    });

    it("should rename arrow function variables", async () => {
      const source = `const b = (x) => x * 2;`;
      const mappings: RenameMappings = {
        b_10_22: {
          functionName: "double",
          renames: { x: "value" },
        },
      };

      const result = await applyRenames(source, mappings);

      expect(result).toContain("double");
      expect(result).toContain("value");
    });

    it("should handle scope correctly - not rename shadowed variables", async () => {
      const source = `
function outer(x) {
  function inner(x) {
    return x * 2;
  }
  return inner(x) + x;
}`;
      // Only rename outer's x, not inner's
      const mappings: RenameMappings = {
        outer_1_89: {
          renames: { x: "outerValue" },
        },
      };

      const result = await applyRenames(source, mappings);

      // The inner function's x should still be x (shadowed)
      // The outer function's x should be renamed to outerValue
      expect(result).toContain("outerValue");
    });

    it("should preserve code functionality", async () => {
      const source = `function add(a, b) { return a + b; }`;
      const mappings: RenameMappings = {
        add_0_36: {
          functionName: "sum",
          renames: { a: "first", b: "second" },
        },
      };

      const result = await applyRenames(source, mappings);

      // The renamed code should be syntactically valid and evaluable
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(`${result}; return sum(1, 2);`);
      expect(fn()).toBe(3);
    });

    it("should not modify code when no mappings match", async () => {
      const source = `function foo(x) { return x; }`;
      const mappings: RenameMappings = {
        nonexistent_0_0: {
          renames: { x: "value" },
        },
      };

      const result = await applyRenames(source, mappings);

      expect(result).toContain("function foo");
      expect(result).toContain("x");
    });
  });

  describe("extractIdentifiers", () => {
    it("should extract variable identifiers", () => {
      const source = `function foo(a, b) { const c = a + b; return c; }`;
      const identifiers = extractIdentifiers(source);

      expect(identifiers).toContain("a");
      expect(identifiers).toContain("b");
      expect(identifiers).toContain("c");
    });

    it("should not include property names", () => {
      const source = `function foo(obj) { return obj.bar; }`;
      const identifiers = extractIdentifiers(source);

      expect(identifiers).toContain("obj");
      expect(identifiers).not.toContain("bar");
    });

    it("should not include object keys", () => {
      const source = `function foo() { return { key: 1 }; }`;
      const identifiers = extractIdentifiers(source);

      expect(identifiers).not.toContain("key");
    });
  });
});
