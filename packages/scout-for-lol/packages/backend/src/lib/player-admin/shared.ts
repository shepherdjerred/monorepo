import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { assertGuildAdmin } from "#src/trpc/guild-guard.ts";
import { prisma } from "#src/database/index.ts";

export const GuildIdInput = z.object({ guildId: DiscordGuildIdSchema });
export const AliasSchema = z.string().trim().min(1).max(100);
export const PlayerLookupInput = GuildIdInput.extend({ alias: AliasSchema });
export const RiotAccountInput = GuildIdInput.extend({
  riotId: RiotIdSchema,
  region: RegionSchema,
});

export type WebCtx = {
  user: User;
  webSession: { ipAddress: string | null; userAgent: string | null };
};

export function notFound(message: string): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message });
}

export function conflict(message: string): TRPCError {
  return new TRPCError({ code: "CONFLICT", message });
}

export async function assertAdmin(ctx: WebCtx, guildId: string): Promise<void> {
  await assertGuildAdmin({ user: ctx.user, guildId });
}

export async function getPlayerOrThrow(input: {
  guildId: string;
  alias: string;
}) {
  const player = await prisma.player.findUnique({
    where: {
      serverId_alias: {
        serverId: input.guildId,
        alias: input.alias,
      },
    },
    include: {
      accounts: true,
      subscriptions: true,
      competitionParticipants: { include: { competition: true } },
    },
  });
  if (player === null) {
    throw notFound(`Player "${input.alias}" was not found`);
  }
  return player;
}
