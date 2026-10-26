import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";

export const DareNotificationCategorySchema = z.enum(["lifecycle", "progress"]);
export const DareNotificationKindSchema = z.enum([
  "published",
  "accepted",
  "declined",
  "activated",
  "cancelled",
  "expired",
  "voided",
  "achieved",
  "failed",
  "advanced",
  "regressed",
  "race_leader_changed",
  "new_best",
  "rank_changed",
  "sequence_changed",
  "streak_changed",
]);

export type DareNotificationEventInput = {
  dareId: number;
  revision: number;
  category: z.infer<typeof DareNotificationCategorySchema>;
  kind: z.infer<typeof DareNotificationKindSchema>;
  actorDiscordId?: string | undefined;
  matchId?: RiotMatchId | undefined;
  summary: string;
  deduplicationKey: string;
  occurredAt: Date;
};

export const DareResultAnnouncementSchema = z.strictObject({
  resolution: z.enum(["achieved", "unachieved", "voided"]),
  challengerDiscordId: DiscordAccountIdSchema,
  plainLanguage: z.string().min(1),
  winners: z.array(
    z.strictObject({
      discordId: DiscordAccountIdSchema,
      alias: z.string().min(1),
    }),
  ),
  voidReason: z.string().min(1).nullable(),
});
export type DareResultAnnouncement = z.infer<
  typeof DareResultAnnouncementSchema
>;

export const DareStatusAnnouncementSchema = z.strictObject({
  dareId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  guildId: DiscordGuildIdSchema,
  category: DareNotificationCategorySchema,
  kind: DareNotificationKindSchema,
  summary: z.string().min(1),
  actorDiscordId: DiscordAccountIdSchema.optional(),
  matchId: RiotMatchIdSchema.optional(),
  result: DareResultAnnouncementSchema.optional(),
});
export type DareStatusAnnouncement = z.infer<
  typeof DareStatusAnnouncementSchema
>;

export const dareStatusAnnouncementCodec = defineVersionedCodec({
  kind: "scout-dare-status-announcement",
  version: 2,
  schema: DareStatusAnnouncementSchema,
});

/** Preserve the lifecycle DM's legacy copy and suppress all mentions. */
export function renderDareStatus(announcement: DareStatusAnnouncement): string {
  const label = announcement.kind.replaceAll("_", " ");
  return `**Dare #${announcement.dareId.toString()} — ${label}**\n${announcement.summary}`;
}
