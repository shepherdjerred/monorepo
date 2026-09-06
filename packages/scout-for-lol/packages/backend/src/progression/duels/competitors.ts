import type { AccountIdSchema } from "@scout-for-lol/data";
import {
  DUEL_DISCLOSURE_VERSION,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  DuelCompetitorSchema,
  PlayerIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type DuelCompetitor,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

type DuelAccountReader = Pick<ExtendedPrismaClient, "account">;

export type DuelCompetitorSelection = {
  readonly accountIds: ReturnType<typeof AccountIdSchema.parse>[];
  readonly teamName?: string;
};

export async function resolveDuelCompetitorSelection(
  db: DuelAccountReader,
  guildId: DiscordGuildId,
  kind: "player" | "pair",
  selection: DuelCompetitorSelection,
) {
  const expected = kind === "player" ? 1 : 2;
  if (selection.accountIds.length !== expected) {
    throw new Error(
      `${kind} competitors require ${expected.toString()} account(s)`,
    );
  }
  if (new Set(selection.accountIds).size !== selection.accountIds.length) {
    throw new Error("A duel competitor cannot select an account twice");
  }
  const accounts = await db.account.findMany({
    where: { id: { in: selection.accountIds }, serverId: guildId },
    include: { player: true },
    orderBy: { id: "asc" },
  });
  if (accounts.length !== expected) {
    throw new Error(
      "Every selected Riot account must be tracked in this guild",
    );
  }
  if (new Set(accounts.map((account) => account.playerId)).size !== expected) {
    throw new Error("A 2v2 pair requires two different guild players");
  }
  if (accounts.some((account) => account.player.discordId === null)) {
    throw new Error("Every duel participant must link a Discord identity");
  }
  return {
    kind,
    teamName: selection.teamName ?? null,
    accounts: accounts.map((account, position) => ({
      playerId: account.playerId,
      playerAlias: account.player.alias,
      accountId: account.id,
      accountAlias: account.alias,
      puuid: account.puuid,
      region: account.region,
      discordId: DiscordAccountIdSchema.parse(account.player.discordId),
      position,
    })),
  };
}

export function duelCompetitorCreateData(
  guildId: DiscordGuildId,
  resolved: Awaited<ReturnType<typeof resolveDuelCompetitorSelection>>,
) {
  return {
    guildId,
    kind: resolved.kind,
    teamName: resolved.teamName,
    members: {
      create: resolved.accounts.map((account) => ({
        playerId: account.playerId,
        accountId: account.accountId,
        puuid: account.puuid,
        region: account.region,
        discordId: account.discordId,
        playerAlias: account.playerAlias,
        accountAlias: account.accountAlias,
        position: account.position,
      })),
    },
  };
}

export function duelSeriesParticipantsCreateData(
  entrants: readonly {
    readonly competitorId: string;
    readonly competitor: {
      readonly members: readonly {
        readonly playerId: number;
        readonly discordId: string;
      }[];
    };
  }[],
) {
  return entrants.flatMap((entrant) =>
    entrant.competitor.members.map((member) => ({
      playerId: PlayerIdSchema.parse(member.playerId),
      competitorId: entrant.competitorId,
      discordId: DiscordAccountIdSchema.parse(member.discordId),
      disclosureVersion: DUEL_DISCLOSURE_VERSION,
      acceptedAt: new Date(),
    })),
  );
}

export function parseDuelCompetitor(row: {
  readonly id: string;
  readonly guildId: string;
  readonly kind: string;
  readonly teamName: string | null;
  readonly members: readonly {
    readonly playerId: number;
    readonly playerAlias: string;
    readonly accountId: number;
    readonly accountAlias: string;
    readonly puuid: string;
    readonly position: number;
  }[];
}): DuelCompetitor {
  DiscordGuildIdSchema.parse(row.guildId);
  return DuelCompetitorSchema.parse({
    id: row.id,
    kind: row.kind,
    teamName: row.teamName,
    accounts: row.members
      .toSorted((left, right) => left.position - right.position)
      .map((member) => ({
        playerId: member.playerId,
        playerAlias: member.playerAlias,
        accountId: member.accountId,
        accountAlias: member.accountAlias,
        puuid: member.puuid,
      })),
  });
}

export async function linkedDuelAccounts(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  discordId: DiscordAccountId,
) {
  return await listDuelAccounts(db, guildId, discordId);
}

export async function eligibleDuelAccounts(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
) {
  return await listDuelAccounts(db, guildId);
}

async function listDuelAccounts(
  db: ExtendedPrismaClient,
  guildId: DiscordGuildId,
  discordId?: DiscordAccountId,
) {
  const players = await db.player.findMany({
    where: {
      serverId: guildId,
      discordId: discordId ?? { not: null },
    },
    orderBy: { alias: "asc" },
    include: { accounts: { orderBy: { alias: "asc" } } },
  });
  return players.flatMap((player) =>
    player.accounts.map((account) => ({
      accountId: account.id,
      accountAlias: account.alias,
      playerId: player.id,
      playerAlias: player.alias,
      region: account.region,
    })),
  );
}
