import { z } from "zod";

const NodeSchema = z.strictObject({
  type: z.enum(["object", "array", "string"]).optional(),
  additionalProperties: z.literal(false).optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  items: z.unknown().optional(),
  const: z.json().optional(),
  enum: z.array(z.json()).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  maxItems: z.number().int().nonnegative().optional(),
});

/** Narrow the imported schema while rejecting keywords unsupported by the C# validator. */
export function readRegexSchema(
  value: unknown,
): Exclude<Parameters<typeof z.fromJSONSchema>[0], boolean> {
  const { properties, items, ...node } = NodeSchema.parse(value);
  const result: Exclude<Parameters<typeof z.fromJSONSchema>[0], boolean> = {
    ...(properties === undefined
      ? {}
      : {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, item]) => [
              key,
              readRegexSchema(item),
            ]),
          ),
        }),
    ...(items === undefined ? {} : { items: readRegexSchema(items) }),
  };
  for (const [key, item] of Object.entries(node)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}
