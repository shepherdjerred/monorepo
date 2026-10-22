import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Who is asking, in the terms Explore can query.
 *
 * Every turn knows the asker's Discord id, but the model was never told what
 * it means. In prod that produced "I can't see your Discord identity" to "Who
 * am I", a random KR match for "my latest match report", and a review that
 * made its asker type their own Riot ID. Scout already links a tracked player
 * to a Discord account (`Player.discordId`); this hands the model that link,
 * per server, so "me" resolves the way a person would expect.
 */
export type ExploreAsker = {
  readonly username: string | null;
  readonly players: readonly {
    readonly serverName: string;
    readonly alias: string;
    readonly riotIds: readonly string[];
  }[];
};

export async function loadExploreAsker(
  input: {
    readonly requesterId: DiscordAccountId;
    readonly guildIds: readonly DiscordGuildId[];
  },
  db: ExtendedPrismaClient = prisma,
): Promise<ExploreAsker> {
  const [user, players] = await Promise.all([
    db.user.findUnique({
      where: { discordId: input.requesterId },
      select: { discordUsername: true },
    }),
    db.player.findMany({
      where: {
        discordId: input.requesterId,
        serverId: { in: [...input.guildIds] },
      },
      include: { accounts: true },
      orderBy: { id: "asc" },
    }),
  ]);
  // The recorded install name, the same source `installedGuildName` reads.
  const installs = await db.guildInstall.findMany({
    where: { serverId: { in: players.map((player) => player.serverId) } },
    select: { serverId: true, serverName: true },
  });
  const names = new Map(
    installs.map((install) => [install.serverId, install.serverName]),
  );
  return {
    username: user?.discordUsername ?? null,
    players: players.map((player) => ({
      serverName: names.get(player.serverId) ?? "this server",
      alias: player.alias,
      riotIds: player.accounts.flatMap((account) =>
        account.riotGameName === null || account.riotTagLine === null
          ? []
          : [`${account.riotGameName}#${account.riotTagLine}`],
      ),
    })),
  };
}

/**
 * The `## Who is asking` section, appended after the static instructions.
 *
 * Last on purpose: the instructions before it are identical for every turn
 * with the same feature set and are read from the prompt cache, and a
 * per-asker section placed earlier would break that prefix for everyone.
 */
export function exploreAskerSection(asker: ExploreAsker): string {
  const who =
    asker.username === null
      ? "The person asking has a Discord account Scout knows by id only."
      : `The person asking is @${asker.username} on Discord.`;
  if (asker.players.length === 0) {
    return [
      "## Who is asking",
      who,
      "They are not linked to a tracked player in the servers in scope. When they ask about themselves ('me', 'my games'), say Scout has not linked them to a player here, ask once for their Riot ID, and offer to track them with a player feed linked to their own Discord account.",
    ].join("\n");
  }
  return [
    "## Who is asking",
    who,
    ...asker.players.map(
      (player) =>
        `In ${player.serverName} they are the tracked player ${player.alias}${
          player.riotIds.length === 0
            ? ""
            : ` (Riot ${player.riotIds.length === 1 ? "ID" : "IDs"} ${player.riotIds.join(", ")})`
        }.`,
    ),
    "'I', 'me', 'my' and 'mine' mean that player. Query them as player('<alias>') and answer directly; never ask who they are or for their Riot ID. If they are tracked under different aliases in different servers, use the one for the server in scope.",
  ].join("\n");
}
