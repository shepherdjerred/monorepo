import { describe, expect, it } from "bun:test";

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
