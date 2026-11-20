import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawSchema from "./overlay-card.schema.json" with { type: "json" };
import rawFixtures from "./overlay-card.fixtures.json" with { type: "json" };
import {
  OVERLAY_CARD_KINDS,
  OverlayCardSchema,
} from "./overlay-card.schema.ts";

const FixturesSchema = z.object({
  valid: z.array(z.object({ name: z.string(), body: z.unknown() })),
  invalid: z.array(z.object({ reason: z.string(), body: z.unknown() })),
});
const fixtures = FixturesSchema.parse(rawFixtures);
const validateWithJsonSchema = new Ajv2020({ strict: true }).compile(rawSchema);

describe("overlay card contract", () => {
  test.each(fixtures.valid)("accepts $name", ({ body }) => {
    expect(OverlayCardSchema.safeParse(body).success).toBe(true);
    expect(validateWithJsonSchema(body)).toBe(true);
  });

  test.each(fixtures.invalid)("refuses $reason", ({ body }) => {
    expect(OverlayCardSchema.safeParse(body).success).toBe(false);
    expect(validateWithJsonSchema(body)).toBe(false);
  });

  test("the kinds are the schema's kinds and every kind has an accept fixture", () => {
    const kinds = z
      .object({
        properties: z.object({ kind: z.object({ enum: z.array(z.string()) }) }),
      })
      .parse(rawSchema).properties.kind.enum;
    expect(kinds).toEqual([...OVERLAY_CARD_KINDS]);
    const covered = new Set(
      fixtures.valid.map(({ body }) => OverlayCardSchema.parse(body).kind),
    );
    expect([...covered].toSorted()).toEqual([...OVERLAY_CARD_KINDS].toSorted());
  });
});
