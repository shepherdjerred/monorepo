import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawLifecycle from "./weekly-parlay.json" with { type: "json" };
import lifecycleSchema from "./weekly-parlay.schema.json" with { type: "json" };
import { WEEKLY_PARLAY_LIFECYCLE } from "./weekly-parlay.ts";

describe("weekly parlay lifecycle contract", () => {
  test("committed JSON conforms to the published JSON Schema", () => {
    const validate = new Ajv2020({ strict: true }).compile(lifecycleSchema);
    expect(validate(rawLifecycle)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("the runtime contract parses the language-neutral source", () => {
    expect(WEEKLY_PARLAY_LIFECYCLE).toEqual(rawLifecycle);
  });
});
