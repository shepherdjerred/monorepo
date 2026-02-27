import { z } from "zod";
import type { Context, Next } from "hono";

const EnvelopeSchema = z.object({
  success: z.boolean(),
}).passthrough();

export async function envelopeMiddleware(
  c: Context,
  next: Next,
): Promise<void> {
  await next();

  const response = c.res;
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json") !== true) return;

  const body: unknown = await response.json();

  const parsed = EnvelopeSchema.safeParse(body);
  if (parsed.success) {
    c.res = Response.json(body, {
      status: response.status,
      headers: response.headers,
    });
    return;
  }

  const wrapped = {
    success: response.status >= 200 && response.status < 400,
    data: body,
  };

  c.res = Response.json(wrapped, {
    status: response.status,
    headers: response.headers,
  });
}
