import { z } from "zod";

/** A current display projection only; never retention or acquisition authority. */
export const RequestInterestProgressSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: z.uuid(),
  observedAt: z.iso.datetime(),
  status: z.enum(["following", "caught_up", "complete", "released", "unknown"]),
  reason: z.string().nullable(),
  counts: z.strictObject({
    requested: z.number().int().nonnegative().nullable(),
    released: z.number().int().nonnegative().nullable(),
    available: z.number().int().nonnegative().nullable(),
    watched: z.number().int().nonnegative().nullable(),
    captionsPending: z.number().int().nonnegative().nullable(),
  }),
});
