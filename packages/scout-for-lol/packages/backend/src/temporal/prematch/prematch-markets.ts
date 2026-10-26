import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { ReceiptKindSchema } from "@scout-for-lol/domain/match-processing/states.ts";
import type { ScoutGuardedEffectResult } from "@scout-for-lol/temporal/activity-contracts";
import { z } from "zod";
/** Retained history vocabulary; current prematch notifications have no markets. */
export const PREMATCH_MARKETS_RECEIPT_KIND =
  ReceiptKindSchema.parse("prematch-markets");
export const prematchMarketsEvidenceCodec = defineVersionedCodec({
  kind: "prematch-markets-evidence",
  version: 1,
  schema: z.strictObject({
    market: z.enum(["classic-participation", "betting-pools", "none"]),
    guildIds: z.array(DiscordGuildIdSchema),
  }),
});
export async function prematchGuildOfChannel(
  channelId: DiscordChannelId,
  database: ExtendedPrismaClient = prisma,
): Promise<DiscordGuildId | null> {
  const subscription = await database.subscription.findFirst({
    where: { channelId: DiscordChannelIdSchema.parse(channelId) },
    select: { serverId: true },
  });
  return subscription === null
    ? null
    : DiscordGuildIdSchema.parse(subscription.serverId);
}

/** Compatibility handler for already scheduled Activity commands. */
export function openPrematchMarkets(_input: {
  riotMatchId: RiotMatchId;
}): Promise<ScoutGuardedEffectResult> {
  return Promise.resolve({
    guard: { outcome: "already-applied" },
    fact: { outcome: "already-applied" },
    effects: 0,
  });
}
