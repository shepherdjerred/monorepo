import { z } from "zod";
import { SportsEventSchema } from "./types.ts";
export const ScheduleTargetSchema = z.strictObject({
  guildId: z.string().regex(/^\d+$/),
  channelId: z.string().regex(/^\d+$/),
  channelName: z.string().min(1),
  statusChannelId: z.string().regex(/^\d+$/),
  userId: z.string().regex(/^\d+$/),
  slot: z.number().int().min(2),
});
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>;
export const PlaybackScheduleSchema = z.strictObject({
  id: z.uuid(),
  target: ScheduleTargetSchema,
  event: SportsEventSchema,
  status: z.enum([
    "pending",
    "starting",
    "playing",
    "completed",
    "cancelled",
    "stopped",
    "failed",
  ]),
  reason: z.enum([
    "waiting",
    "listeners",
    "busy",
    "capacity",
    "broadcast",
    "permission",
    "disabled",
    "missing",
    "ambiguous",
    "none",
  ]),
  createdAt: z.number(),
});
export type PlaybackSchedule = z.infer<typeof PlaybackScheduleSchema>;
export const ScheduleResultsSchema = z.array(
  z.strictObject({
    id: z.string(),
    title: z.string(),
    startsAt: z.string().nullable(),
    status: PlaybackScheduleSchema.shape.status,
    reason: PlaybackScheduleSchema.shape.reason,
    slot: z.number(),
    channelId: z.string(),
    channelName: z.string(),
  }),
);
