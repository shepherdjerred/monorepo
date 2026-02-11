import { describe, it, expect } from "bun:test";

// Note: This rule requires TypeScript's type checker to work properly.
// The tests below verify the rule is exported correctly, but comprehensive
// testing of type-dependent functionality would require a more complex setup
// with a real TypeScript program.

describe("zod-schema-naming", () => {
  it("exports the rule correctly", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { zodSchemaNaming } = require("./zod-schema-naming");
    expect(zodSchemaNaming).toBeDefined();
    expect(zodSchemaNaming.meta).toBeDefined();
    expect(zodSchemaNaming.meta.type).toBe("suggestion");
    expect(zodSchemaNaming.meta.docs.description).toContain("PascalCase");
  });
});
