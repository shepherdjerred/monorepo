import { z } from "zod";

const TrpcErrorSchema = z.object({ data: z.object({ code: z.string() }) });

/**
 * Whether the server answered "no such game": the game ended and its roster
 * was purged, or the viewer has no friend in it. The two are alike by design,
 * so the page says the same thing for both.
 */
export function isGameNotFound(error: unknown): boolean {
  const parsed = TrpcErrorSchema.safeParse(error);
  return parsed.success && parsed.data.data.code === "NOT_FOUND";
}
