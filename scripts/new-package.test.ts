import { describe, expect, test } from "bun:test";
import { packageFiles, validatePackageName } from "./migration-core.ts";

describe("new-package", () => {
  test("requires kebab-case", () => {
    expect(() => validatePackageName("Bad_Name")).toThrow("kebab-name");
    expect(() => validatePackageName()).toThrow("kebab-name");
  });

  test("creates strict quality configuration", () => {
    const files = packageFiles(validatePackageName("example-package"));
    expect(files["package.json"]).toContain('"typecheck": "tsc --noEmit"');
    expect(files["eslint.config.ts"]).toContain("recommended");
    expect(files["src/index.test.ts"]).toContain("bun:test");
  });
});
