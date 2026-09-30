import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";

export const DareNotificationCategorySchema = z.enum(["lifecycle", "progress"]);
export const DareNotificationKindSchema = z.enum([
  "funded",
  "accepted",
  "declined",
  "contributed",
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
  matchId?: string | undefined;
  summary: string;
  deduplicationKey: string;
  occurredAt: Date;
};

export const DareStatusAnnouncementSchema = z.strictObject({
  dareId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  guildId: DiscordGuildIdSchema,
  category: DareNotificationCategorySchema,
  kind: DareNotificationKindSchema,
  summary: z.string().min(1),
  actorDiscordId: DiscordAccountIdSchema.optional(),
  matchId: z.string().min(1).optional(),
});
export type DareStatusAnnouncement = z.infer<
  typeof DareStatusAnnouncementSchema
>;

export const dareStatusAnnouncementCodec = defineVersionedCodec({
  kind: "scout-dare-status-announcement",
  version: 1,
  schema: DareStatusAnnouncementSchema,
});

/** Preserve the lifecycle DM's legacy copy and suppress all mentions. */
export function renderDareStatus(announcement: DareStatusAnnouncement): string {
  const label = announcement.kind.replaceAll("_", " ");
  return `**Dare #${announcement.dareId.toString()} — ${label}**\n${announcement.summary}`;
}
