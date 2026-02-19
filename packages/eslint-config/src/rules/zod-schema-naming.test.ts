import { describe, expect, it } from "bun:test";
import { zodSchemaNaming } from "./zod-schema-naming.ts";

describe("zod-schema-naming", () => {
  it("exports the rule correctly", () => {
    expect(zodSchemaNaming).toBeDefined();
    expect(zodSchemaNaming.meta).toBeDefined();
    expect(zodSchemaNaming.meta.type).toBe("suggestion");
    expect(zodSchemaNaming.meta.docs.description).toContain("PascalCase");
  });
});
