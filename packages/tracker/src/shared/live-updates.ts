import { z } from "zod";

/** One committed audit event, as named by the `tracker_events` notification. */
export const LiveChangeSchema = z.object({
  eventId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  issueIdentifier: z.string().min(1).nullable(),
  action: z.string().min(1),
  actorId: z.string().min(1),
  requestId: z.string().min(1),
  occurredAt: z.iso.datetime(),
});
export type LiveChange = z.infer<typeof LiveChangeSchema>;

/**
 * A message on `GET /api/events/stream`. `change` names one committed event;
 * `resync` means changes may have been missed, so refetch everything shown.
 */
export const LiveMessageSchema = z.discriminatedUnion("type", [
  LiveChangeSchema.extend({ type: z.literal("change") }),
  z.object({ type: z.literal("resync") }),
]);
export type LiveMessage = z.infer<typeof LiveMessageSchema>;
