import { z } from "zod";
import type { PermissionSet } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import {
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

export function serializePlayerSummary(
  player: {
    id: number;
    alias: string;
    discordId: string | null;
    updatedTime: Date;
    accounts: { id: number }[];
    subscriptions: { id: number; channelId: string }[];
  },
  names: DiscordNames,
  permissions: PermissionSet,
) {
  return {
    id: player.id,
    alias: player.alias,
    discordId: player.discordId,
    discordUser: lookupUser(names, player.discordId),
    updatedTime: player.updatedTime,
    accountCount: permissions.can("accounts", "read")
      ? player.accounts.length
      : 0,
    subscriptionCount: permissions.can("subscriptions", "read")
      ? player.subscriptions.length
      : 0,
    channelIds: permissions.can("subscriptions", "read")
      ? player.subscriptions.map((subscription) => subscription.channelId)
      : [],
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
  permissions: PermissionSet,
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
    accounts: permissions.can("accounts", "read")
      ? player.accounts.map((account) => ({
          id: account.id,
          alias: account.alias,
          puuid: account.puuid,
          region: account.region,
          riotGameName: account.riotGameName,
          riotTagLine: account.riotTagLine,
          lastMatchTime: account.lastMatchTime,
          lastCheckedAt: account.lastCheckedAt,
        }))
      : [],
    subscriptions: permissions.can("subscriptions", "read")
      ? player.subscriptions.map((subscription) => ({
          id: subscription.id,
          channelId: subscription.channelId,
          creatorDiscordId: subscription.creatorDiscordId,
          creatorDiscordUser: lookupUser(names, subscription.creatorDiscordId),
          createdTime: subscription.createdTime,
        }))
      : [],
    competitions: permissions.can("competitions", "read")
      ? player.competitionParticipants.map((participant) => ({
          id: participant.id,
          status: participant.status,
          invitedBy: participant.invitedBy,
          invitedByUser: lookupUser(names, participant.invitedBy),
          invitedAt: participant.invitedAt,
          joinedAt: participant.joinedAt,
          leftAt: participant.leftAt,
          competition: participant.competition,
        }))
      : [],
  };
}

export async function listPlayers(
  input: ListPlayersInputData,
  permissions: PermissionSet,
) {
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
    items: items.map((item) =>
      serializePlayerSummary(item, names, permissions),
    ),
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

/**
 * Refresh stale/never-resolved Riot IDs for the player's accounts, overlay
 * the freshly resolved values onto the rows, then serialize. Keeps the
 * displayed Riot ID at most 24h stale without blocking on every account.
 */
type PlayerDetailInput = Parameters<typeof serializePlayerDetail>[0];
type RefreshablePlayerDetail = Omit<PlayerDetailInput, "accounts"> & {
  accounts: (PlayerDetailInput["accounts"][number] & AccountRiotRow)[];
};

async function serializePlayerDetailWithRiotRefresh(
  player: RefreshablePlayerDetail,
  permissions: PermissionSet,
) {
  const accounts = await refreshAuthorizedAccounts(
    player.accounts,
    permissions,
  );
  const subscriptionCreatorIds = permissions.can("subscriptions", "read")
    ? player.subscriptions.map((subscription) => subscription.creatorDiscordId)
    : [];
  const competitionInviterIds = permissions.can("competitions", "read")
    ? player.competitionParticipants.map((participant) => participant.invitedBy)
    : [];
  const discordIds = [
    player.discordId,
    player.creatorDiscordId,
    ...subscriptionCreatorIds,
    ...competitionInviterIds,
  ].flatMap((id) => (id === null ? [] : [id]));
  const names = await resolveDiscordUsers(discordIds);
  return serializePlayerDetail({ ...player, accounts }, names, permissions);
}

async function refreshAuthorizedAccounts<T extends AccountRiotRow>(
  accounts: T[],
  permissions: PermissionSet,
): Promise<T[]> {
  if (permissions.cannot("accounts", "read")) return [];
  const resolved = await refreshAccountRiotIds(accounts);
  return accounts.map((account) => {
    const fresh = resolved.get(account.id);
    return fresh === undefined
      ? account
      : {
          ...account,
          riotGameName: fresh.gameName,
          riotTagLine: fresh.tagLine,
        };
  });
}

export async function getPlayer(
  input: PlayerLookupInputData,
  permissions: PermissionSet,
) {
  const player = await getPlayerOrThrow(input);
  return serializePlayerDetailWithRiotRefresh(player, permissions);
}

export async function getCurrentLinkedPlayer(
  ctx: WebCtx,
  input: z.infer<typeof GuildIdInput>,
  permissions: PermissionSet,
) {
  const player = await prisma.player.findFirst({
    where: { serverId: input.guildId, discordId: ctx.user.discordId },
    include: playerDetailInclude,
  });
  if (player === null) return null;
  return serializePlayerDetailWithRiotRefresh(player, permissions);
}
