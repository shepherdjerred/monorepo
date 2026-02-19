import { describe, expect, it } from "bun:test";
import { noRedundantZodParse } from "./no-redundant-zod-parse.ts";

describe("no-redundant-zod-parse", () => {
  it("exports the rule correctly", () => {
    expect(noRedundantZodParse).toBeDefined();
    expect(noRedundantZodParse.meta).toBeDefined();
    expect(noRedundantZodParse.meta.type).toBe("problem");
    expect(noRedundantZodParse.meta.docs.description).toContain(
      "parsing values",
    );
  });
});
