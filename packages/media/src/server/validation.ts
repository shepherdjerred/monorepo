import type { z } from "zod";
import { MediaError } from "#application/errors.ts";

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new MediaError(
      "invalid_input",
      "Request does not match the expected format",
      400,
    );
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new MediaError(
        "invalid_json",
        "Request body is not valid JSON",
        400,
      );
    throw error;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (header === null) return undefined;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (entry.slice(0, separator).trim() === name)
      return entry.slice(separator + 1).trim();
  }
  return undefined;
}
