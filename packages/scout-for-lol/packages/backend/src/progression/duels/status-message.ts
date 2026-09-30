import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";

/** The presentation facts stored by both the legacy outbox and V2 intent. */
export const DuelStatusPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("invited"),
    seriesId: z.uuid(),
    mentionDiscordIds: DiscordAccountIdSchema.array(),
  }),
  z.strictObject({
    kind: z.literal("overdue"),
    seriesId: z.uuid(),
    mentionDiscordIds: DiscordAccountIdSchema.array(),
  }),
  z.strictObject({
    kind: z.literal("code_ready"),
    seriesId: z.uuid(),
    gameNumber: z.number().int().positive(),
  }),
]);
export type DuelStatusPayload = z.infer<typeof DuelStatusPayloadSchema>;

export const DuelStatusAnnouncementSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  payload: DuelStatusPayloadSchema,
});

export const duelStatusAnnouncementCodec = defineVersionedCodec({
  kind: "scout-duel-status-announcement",
  version: 1,
  schema: DuelStatusAnnouncementSchema,
});
