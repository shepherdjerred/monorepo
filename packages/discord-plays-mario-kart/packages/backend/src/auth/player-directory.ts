// The latest name and avatar of every Discord user who has signed in or held a
// seat. Stats read it so a leaderboard shows today's names, not race-day ones.
import type { PrismaClient } from "#generated/prisma/client/index.js";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

export type PlayerDirectory = {
  upsert: (user: DiscordUser) => Promise<void>;
  get: (discordId: string) => Promise<DiscordUser | undefined>;
  getMany: (discordIds: readonly string[]) => Promise<Map<string, DiscordUser>>;
};

type PlayerRow = {
  discordId: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

function toUser(row: PlayerRow): DiscordUser {
  return {
    discordId: row.discordId,
    username: row.username,
    name: row.name,
    avatarUrl: row.avatarUrl,
  };
}

export function createPlayerDirectory(prisma: PrismaClient): PlayerDirectory {
  return {
    async upsert(user) {
      const data = {
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
      };
      await prisma.player.upsert({
        where: { discordId: user.discordId },
        create: { discordId: user.discordId, ...data },
        update: data,
      });
    },
    async get(discordId) {
      const row = await prisma.player.findUnique({ where: { discordId } });
      return row === null ? undefined : toUser(row);
    },
    async getMany(discordIds) {
      const rows = await prisma.player.findMany({
        where: { discordId: { in: [...new Set(discordIds)] } },
      });
      return new Map(rows.map((row) => [row.discordId, toUser(row)]));
    },
  };
}
