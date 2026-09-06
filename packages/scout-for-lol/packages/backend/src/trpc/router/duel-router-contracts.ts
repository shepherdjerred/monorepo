import { z } from "zod";
import {
  AccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  DuelBestOfSchema,
  DuelEventFormatSchema,
  DuelRulesetV1Schema,
} from "@scout-for-lol/data";

export const DuelGuildInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
});

export const DuelCompetitorSelectionInputSchema = z.strictObject({
  accountIds: AccountIdSchema.array().min(1).max(2),
  teamName: z.string().trim().min(1).max(80).optional(),
});

export const DirectDuelChallengeInputSchema = z.strictObject({
  requestId: z.uuid(),
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  competitorKind: z.enum(["player", "pair"]),
  first: DuelCompetitorSelectionInputSchema,
  second: DuelCompetitorSelectionInputSchema,
  bestOf: DuelBestOfSchema,
  ruleset: DuelRulesetV1Schema,
  matchWindowHours: z.number().int().min(24).max(336).default(168),
});

export const DuelEventInputSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  channelId: DiscordChannelIdSchema,
  name: z.string().trim().min(1).max(120),
  format: DuelEventFormatSchema.exclude(["direct"]),
  competitorKind: z.enum(["player", "pair"]),
  bestOf: DuelBestOfSchema,
  ruleset: DuelRulesetV1Schema,
  registrationMode: z.enum(["open", "invitations"]),
  seedMethod: z.enum(["manual", "random", "rolling_record"]),
  matchWindowHours: z.number().int().min(24).max(336).default(168),
  registrationClosesAt: z.date().optional(),
  roundOverrides: z
    .array(
      z.strictObject({
        roundNumber: z.number().int().positive(),
        bestOf: DuelBestOfSchema,
      }),
    )
    .default([]),
});

export function duelCompetitorSelection(
  input: z.infer<typeof DuelCompetitorSelectionInputSchema>,
) {
  return {
    accountIds: input.accountIds,
    ...(input.teamName === undefined ? {} : { teamName: input.teamName }),
  };
}
