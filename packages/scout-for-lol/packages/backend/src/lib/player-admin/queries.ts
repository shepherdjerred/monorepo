import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import {
  assertAdmin,
  GuildIdInput,
  getPlayerOrThrow,
  type PlayerLookupInput,
  type WebCtx,
} from "#src/lib/player-admin/shared.ts";

export const ListPlayersInput = GuildIdInput.extend({
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.number().int().min(1).optional(),
});

export type ListPlayersInputData = z.infer<typeof ListPlayersInput>;
export type PlayerLookupInputData = z.infer<typeof PlayerLookupInput>;

function serializePlayerSummary(player: {
  id: number;
  alias: string;
  discordId: string | null;
  updatedTime: Date;
  accounts: { id: number }[];
  subscriptions: { id: number; channelId: string }[];
}) {
  return {
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    updatedTime: player.updatedTime,
    accountCount: player.accounts.length,
    subscriptionCount: player.subscriptions.length,
    channelIds: player.subscriptions.map(
      (subscription) => subscription.channelId,
    ),
  };
}

export function serializePlayerDetail(player: {
  id: number;
  alias: string;
  discordId: string | null;
  creatorDiscordId: string;
  createdTime: Date;
  updatedTime: Date;
  accounts: {
    id: number;
    alias: string;
    puuid: string;
    region: string;
    lastMatchTime: Date | null;
    lastCheckedAt: Date | null;
  }[];
  subscriptions: {
    id: number;
    channelId: string;
    creatorDiscordId: string;
    createdTime: Date;
  }[];
  competitionParticipants: {
    id: number;
    status: string;
    invitedBy: string | null;
    invitedAt: Date | null;
    joinedAt: Date | null;
    leftAt: Date | null;
    competition: {
      id: number;
      title: string;
      isCancelled: boolean;
      visibility: string;
      startDate: Date | null;
      endDate: Date | null;
      seasonId: string | null;
    };
  }[];
}) {
  return {
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    creatorDiscordId: player.creatorDiscordId,
    createdTime: player.createdTime,
    updatedTime: player.updatedTime,
    accounts: player.accounts.map((account) => ({
      id: account.id,
      alias: account.alias,
      puuid: account.puuid,
      region: account.region,
      lastMatchTime: account.lastMatchTime,
      lastCheckedAt: account.lastCheckedAt,
    })),
    subscriptions: player.subscriptions.map((subscription) => ({
      id: subscription.id,
      channelId: subscription.channelId,
      creatorDiscordId: subscription.creatorDiscordId,
      createdTime: subscription.createdTime,
    })),
    competitions: player.competitionParticipants.map((participant) => ({
      id: participant.id,
      status: participant.status,
      invitedBy: participant.invitedBy,
      invitedAt: participant.invitedAt,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
      competition: participant.competition,
    })),
  };
}

export async function listPlayers(ctx: WebCtx, input: ListPlayersInputData) {
  await assertAdmin(ctx, input.guildId);
  const rows = await prisma.player.findMany({
    where: {
      serverId: input.guildId,
      ...(input.query !== undefined && input.query.length > 0
        ? { alias: { contains: input.query } }
        : {}),
    },
    include: {
      accounts: { select: { id: true } },
      subscriptions: { select: { id: true, channelId: true } },
    },
    orderBy: [{ alias: "asc" }, { id: "asc" }],
    take: input.limit + 1,
    ...(input.cursor === undefined
      ? {}
      : { cursor: { id: input.cursor }, skip: 1 }),
  });
  const items = rows.slice(0, input.limit);
  const overflow = rows.at(input.limit);
  return {
    items: items.map((item) => serializePlayerSummary(item)),
    nextCursor: overflow?.id ?? null,
  };
}

export async function getPlayer(ctx: WebCtx, input: PlayerLookupInputData) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow(input);
  return serializePlayerDetail(player);
}

export async function getCurrentLinkedPlayer(
  ctx: WebCtx,
  input: z.infer<typeof GuildIdInput>,
) {
  await assertAdmin(ctx, input.guildId);
  const player = await prisma.player.findFirst({
    where: { serverId: input.guildId, discordId: ctx.user.discordId },
  });
  if (player === null) return null;
  const detailed = await getPlayerOrThrow({
    guildId: input.guildId,
    alias: player.alias,
  });
  return serializePlayerDetail(detailed);
}
