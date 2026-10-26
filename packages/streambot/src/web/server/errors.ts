import type { z } from "zod";

export class WebError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requestInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new WebError(
      400,
      "invalid_request",
      "Check your input and try again.",
    );
  return parsed.data;
}

export async function readRequestInput<Schema extends z.ZodType>(
  schema: Schema,
  request: Request,
): Promise<z.output<Schema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new WebError(
        400,
        "invalid_request",
        "Check your input and try again.",
      );
    throw error;
  }
  return requestInput(schema, value);
}
