import { z } from "zod/v4";

export function parseJsonArray<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  try {
    return z.array(schema).parse(JSON.parse(raw));
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
