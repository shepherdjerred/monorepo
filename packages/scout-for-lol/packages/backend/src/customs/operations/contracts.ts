import { z } from "zod";
import {
  CustomNightSnapshotSchema,
  CustomGameParticipantSchema,
  CustomIntermissionChoiceSchema,
} from "@scout-for-lol/data";
import { ScoutCustomOperationActionSchema } from "@scout-for-lol/temporal";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";

export const CustomOperationPayloadSchema = z.strictObject({
  version: z.literal(1),
  action: ScoutCustomOperationActionSchema,
  snapshot: CustomNightSnapshotSchema,
  choice: CustomIntermissionChoiceSchema.optional(),
  reason: z.string().min(1).max(1000).optional(),
  nextGame: z
    .strictObject({
      id: z.uuid(),
      participants: z.array(CustomGameParticipantSchema),
    })
    .optional(),
});
export type CustomOperationPayload = z.infer<
  typeof CustomOperationPayloadSchema
>;
export const CustomOperationProgressSchema = z.strictObject({
  version: z.literal(1),
  step: z.string().min(1),
  channels: z.strictObject({
    A: DiscordChannelIdSchema.optional(),
    B: DiscordChannelIdSchema.optional(),
  }),
  creating: z.enum(["A", "B"]).nullable(),
  moved: z.array(z.string().min(1)),
  deleted: z.array(DiscordChannelIdSchema),
  expiredAt: z.iso.datetime().optional(),
});
export type CustomOperationProgress = z.infer<
  typeof CustomOperationProgressSchema
>;
export function initialCustomOperationProgress(): CustomOperationProgress {
  return {
    version: 1,
    step: "Queued",
    channels: {},
    creating: null,
    moved: [],
    deleted: [],
  };
}
