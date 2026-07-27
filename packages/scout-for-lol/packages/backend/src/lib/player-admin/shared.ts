import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordGuildIdSchema,
  RegionSchema,
  RiotIdSchema,
} from "@scout-for-lol/data";
import { Prisma, type User } from "#generated/prisma/client/index.js";
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

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export const playerDetailInclude = {
  accounts: true,
  subscriptions: true,
  // Season must be joined so parseCompetition can resolve effective dates for
  // season-based competitions (their own startDate/endDate columns are null).
  competitionParticipants: {
    include: { competition: { include: { season: true } } },
  },
} satisfies Prisma.PlayerInclude;

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
    include: playerDetailInclude,
  });
  if (player === null) {
    throw notFound(`Player "${input.alias}" was not found`);
  }
  return player;
}
