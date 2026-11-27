import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";

const ScopedPlayerSelect = {
  id: true,
  alias: true,
  serverId: true,
  discordId: true,
  accounts: {
    select: {
      puuid: true,
      riotGameName: true,
      riotTagLine: true,
      region: true,
    },
  },
} as const;

async function findScopedPlayers(guildIds: readonly DiscordGuildId[]) {
  return await prisma.player.findMany({
    where: { serverId: { in: [...guildIds] } },
    select: ScopedPlayerSelect,
  });
}

export type ScopedChampionPlayer = Awaited<
  ReturnType<typeof findScopedPlayers>
>[number];

/**
 * The players in the requested guilds (default: every guild the viewer can
 * use), after the same per-request access check every consumer page makes.
 */
export async function getScopedChampionPlayers(
  user: Parameters<typeof assertConsumerPlayerScope>[0],
  requestedGuildIds: readonly DiscordGuildId[] | undefined,
) {
  const accessibleGuilds = await assertConsumerPlayerScope(user);
  const accessibleIds = new Set(accessibleGuilds.map((guild) => guild.id));
  const selectedGuildIds =
    requestedGuildIds ??
    accessibleGuilds.map((guild) => DiscordGuildIdSchema.parse(guild.id));
  if (selectedGuildIds.some((guildId) => !accessibleIds.has(guildId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requested guild is outside the current player scope",
    });
  }
  return {
    accessibleGuilds,
    players: await findScopedPlayers(selectedGuildIds),
  };
}

export type ChampionPagePerson = {
  /** The lowest player id among the person's rows. */
  playerId: number;
  alias: string;
  isViewer: boolean;
  guilds: { guildId: DiscordGuildId; name: string }[];
  puuids: LeaguePuuid[];
};

/**
 * One entry per real person. A person with several accounts has one entry, and
 * a person in several of the viewer's servers (the same Discord account on a
 * player in each) is one entry too, so a champion's games and players are
 * counted once however many accounts or servers they are in.
 */
export function groupChampionPagePeople(options: {
  players: readonly ScopedChampionPlayer[];
  guildNames: ReadonlyMap<string, string>;
  viewerDiscordId: string;
}): ChampionPagePerson[] {
  const ordered = options.players.toSorted((left, right) => left.id - right.id);
  const people = new Map<string, ChampionPagePerson>();
  for (const player of ordered) {
    const guildName = options.guildNames.get(player.serverId);
    if (guildName === undefined) {
      throw new Error("Champion page returned an unscoped guild");
    }
    const key =
      player.discordId === null
        ? `player:${player.id.toString()}`
        : `discord:${player.discordId}`;
    const person = people.get(key) ?? {
      playerId: player.id,
      alias: player.alias,
      isViewer: player.discordId === options.viewerDiscordId,
      guilds: [],
      puuids: [],
    };
    person.guilds.push({
      guildId: DiscordGuildIdSchema.parse(player.serverId),
      name: guildName,
    });
    for (const account of player.accounts) {
      if (!person.puuids.includes(account.puuid)) {
        person.puuids.push(account.puuid);
      }
    }
    people.set(key, person);
  }
  return [...people.values()]
    .map((person) => ({
      ...person,
      guilds: person.guilds.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
    }))
    .filter((person) => person.puuids.length > 0);
}

/** The people a champion page covers, after the per-request access check. */
export async function getChampionPagePeople(
  user: Parameters<typeof assertConsumerPlayerScope>[0],
  requestedGuildIds: readonly DiscordGuildId[] | undefined,
) {
  const { accessibleGuilds, players } = await getScopedChampionPlayers(
    user,
    requestedGuildIds,
  );
  const people = groupChampionPagePeople({
    players,
    guildNames: new Map(
      accessibleGuilds.map((guild) => [guild.id, guild.name] as const),
    ),
    viewerDiscordId: user.discordId,
  });
  return { accessibleGuilds, people };
}

export function pageEntries(people: readonly ChampionPagePerson[]) {
  return people.map((person) => ({
    entryKey: person.playerId.toString(),
    puuids: person.puuids,
  }));
}
