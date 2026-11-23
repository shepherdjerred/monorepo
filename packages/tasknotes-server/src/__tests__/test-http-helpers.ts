import type { Hono } from "hono";
import { z } from "zod";

export const McpRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export function bearerHeaders(
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function reqStatus(
  app: Hono,
  path: string,
  init?: RequestInit,
): Promise<number> {
  const res = await app.request(path, init);
  return res.status;
}

export async function reqJson<T>(
  app: Hono,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await app.request(path, init);
  const raw: unknown = await res.json();
  return schema.parse(raw);
}
