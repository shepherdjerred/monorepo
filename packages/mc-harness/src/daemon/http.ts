import type { z } from "zod";

/** A request the daemon rejects with a status and a message. */
export class DaemonError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function body<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new DaemonError("Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DaemonError(`Invalid request: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Validates an outgoing body so the daemon never emits off-contract JSON. */
export function reply(schema: z.ZodType, value: unknown): Response {
  return Response.json(schema.parse(value));
}
