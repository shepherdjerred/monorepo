import type { z } from "zod";

/** Parse a persisted JSON column and validate its typed contract in one step. */
export function parseProgressionJson<T>(
  serialized: string,
  schema: z.ZodType<T>,
): T {
  return schema.parse(JSON.parse(serialized));
}
