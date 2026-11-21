import type { ErrorHandler } from "hono";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";

export const CancelSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
});
export const RestrictSchema = CancelSchema.extend({ restricted: z.boolean() });

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

/**
 * The application's error contract: a `MediaError` is an expected outcome and
 * is returned as its code and status; anything else is reported with the
 * request ID and answered without detail.
 */
export function mediaErrorResponse(
  onError: (error: Error, requestId: string) => void,
): ErrorHandler<{ Variables: { actor: MediaActor; requestId: string } }> {
  return (error, c) => {
    if (error instanceof MediaError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    onError(error, c.get("requestId"));
    return c.json(
      {
        error: {
          code: "internal_error",
          message: "The operation failed; use the request ID for investigation",
        },
      },
      500,
    );
  };
}
