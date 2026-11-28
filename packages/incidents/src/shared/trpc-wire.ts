/**
 * tRPC's HTTP envelopes as this module sends them (no transformer, no
 * batching). The browser client and the test harness both parse responses
 * with these, so the shape is stated once.
 */
import { z } from "zod";

export const TrpcResultSchema = z.object({
  result: z.object({ data: z.unknown() }),
});

/** `data.incident` carries `IncidentErrorDataSchema`'s payload on CONFLICT. */
export const TrpcErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    data: z.looseObject({ code: z.string(), incident: z.unknown().optional() }),
  }),
});
