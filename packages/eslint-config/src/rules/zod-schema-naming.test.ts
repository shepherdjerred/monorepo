import { describe, expect, it } from "bun:test";

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
