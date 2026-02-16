import { describe, it, expect } from "bun:test";

// Note: This rule requires TypeScript's type checker to work properly.
// The tests below verify the rule is exported correctly, but comprehensive
// testing of type-dependent functionality would require a more complex setup
// with a real TypeScript program.

describe("no-redundant-zod-parse", () => {
  it("exports the rule correctly", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { noRedundantZodParse } = require("./no-redundant-zod-parse");
    expect(noRedundantZodParse).toBeDefined();
    expect(noRedundantZodParse.meta).toBeDefined();
    expect(noRedundantZodParse.meta.type).toBe("problem");
    expect(noRedundantZodParse.meta.docs.description).toContain("parsing values");
  });
});
