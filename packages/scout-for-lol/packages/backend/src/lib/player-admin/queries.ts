import { z } from "zod";
import { prisma } from "#src/database/index.ts";
import {
  assertAdmin,
  GuildIdInput,
  getPlayerOrThrow,
  playerDetailInclude,
  type PlayerLookupInput,
  type WebCtx,
} from "#src/lib/player-admin/shared.ts";
import {
  type AccountRiotRow,
  refreshAccountRiotIds,
} from "#src/lib/riot/account-riot-id.ts";
import {
  type ResolvedDiscordUser,
  resolveDiscordUsers,
} from "#src/lib/discord/resolve-users.ts";

type DiscordNames = Record<string, ResolvedDiscordUser>;

function lookupUser(
  names: DiscordNames,
  id: string | null,
): ResolvedDiscordUser | null {
  if (id === null) return null;
  return names[id] ?? null;
}

export const ListPlayersInput = GuildIdInput.extend({
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.number().int().min(1).optional(),
});

export type ListPlayersInputData = z.infer<typeof ListPlayersInput>;
export type PlayerLookupInputData = z.infer<typeof PlayerLookupInput>;

function serializePlayerSummary(
  player: {
    id: number;
    alias: string;
    discordId: string | null;
    updatedTime: Date;
    accounts: { id: number }[];
    subscriptions: { id: number; channelId: string }[];
  },
  names: DiscordNames,
) {
  return {
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    discordUser: lookupUser(names, player.discordId),
    updatedTime: player.updatedTime,
    accountCount: player.accounts.length,
    subscriptionCount: player.subscriptions.length,
    channelIds: player.subscriptions.map(
      (subscription) => subscription.channelId,
    ),
  };
}

export function serializePlayerDetail(
  player: {
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
      riotGameName: string | null;
      riotTagLine: string | null;
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
  },
  names: DiscordNames,
) {
  return {
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    discordUser: lookupUser(names, player.discordId),
    creatorDiscordId: player.creatorDiscordId,
    creatorDiscordUser: lookupUser(names, player.creatorDiscordId),
    createdTime: player.createdTime,
    updatedTime: player.updatedTime,
    accounts: player.accounts.map((account) => ({
      id: account.id,
      alias: account.alias,
      puuid: account.puuid,
      region: account.region,
      riotGameName: account.riotGameName,
      riotTagLine: account.riotTagLine,
      lastMatchTime: account.lastMatchTime,
      lastCheckedAt: account.lastCheckedAt,
    })),
    subscriptions: player.subscriptions.map((subscription) => ({
      id: subscription.id,
      channelId: subscription.channelId,
      creatorDiscordId: subscription.creatorDiscordId,
      creatorDiscordUser: lookupUser(names, subscription.creatorDiscordId),
      createdTime: subscription.createdTime,
    })),
    competitions: player.competitionParticipants.map((participant) => ({
      id: participant.id,
      status: participant.status,
      invitedBy: participant.invitedBy,
      invitedByUser: lookupUser(names, participant.invitedBy),
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
  const hasMore = rows.length > input.limit;
  const names = await resolveDiscordUsers(
    items.flatMap((item) => (item.discordId === null ? [] : [item.discordId])),
  );
  // Cursor is the last returned row's id (next page resumes after it).
  return {
    items: items.map((item) => serializePlayerSummary(item, names)),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

/**
 * Refresh stale/never-resolved Riot IDs for the player's accounts, overlay
 * the freshly resolved values onto the rows, then serialize. Keeps the
 * displayed Riot ID at most 24h stale without blocking on every account.
 */
async function serializePlayerDetailWithRiotRefresh(
  player: Parameters<typeof serializePlayerDetail>[0] & {
    accounts: AccountRiotRow[];
  },
) {
  const resolved = await refreshAccountRiotIds(player.accounts);
  const accounts = player.accounts.map((account) => {
    const fresh = resolved.get(account.id);
    return fresh === undefined
      ? account
      : {
          ...account,
          riotGameName: fresh.gameName,
          riotTagLine: fresh.tagLine,
        };
  });
  const discordIds = [
    player.discordId,
    player.creatorDiscordId,
    ...player.subscriptions.map(
      (subscription) => subscription.creatorDiscordId,
    ),
    ...player.competitionParticipants.map(
      (participant) => participant.invitedBy,
    ),
  ].flatMap((id) => (id === null ? [] : [id]));
  const names = await resolveDiscordUsers(discordIds);
  return serializePlayerDetail({ ...player, accounts }, names);
}

export async function getPlayer(ctx: WebCtx, input: PlayerLookupInputData) {
  await assertAdmin(ctx, input.guildId);
  const player = await getPlayerOrThrow(input);
  return serializePlayerDetailWithRiotRefresh(player);
}

export async function getCurrentLinkedPlayer(
  ctx: WebCtx,
  input: z.infer<typeof GuildIdInput>,
) {
  await assertAdmin(ctx, input.guildId);
  const player = await prisma.player.findFirst({
    where: { serverId: input.guildId, discordId: ctx.user.discordId },
    include: playerDetailInclude,
  });
  if (player === null) return null;
  return serializePlayerDetailWithRiotRefresh(player);
}
