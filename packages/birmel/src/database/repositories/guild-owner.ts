import { prisma } from "../index.js";
import type { GuildOwner } from "@prisma/client";

export async function getGuildOwner(
  guildId: string,
): Promise<GuildOwner | null> {
  return prisma.guildOwner.findUnique({ where: { guildId } });
}

export async function getOrCreateGuildOwner(
  guildId: string,
): Promise<GuildOwner> {
  const existing = await getGuildOwner(guildId);
  if (existing) {
    return existing;
  }

  return prisma.guildOwner.create({
    data: {
      guildId,
      currentOwner: "jerred",
      nickname: "Berred",
    },
  });
}

export async function setGuildOwner(
  guildId: string,
  owner: string,
  nickname: string,
): Promise<GuildOwner> {
  return prisma.guildOwner.upsert({
    where: { guildId },
    update: {
      currentOwner: owner,
      nickname,
      lastElectionAt: new Date(),
    },
    create: {
      guildId,
      currentOwner: owner,
      nickname,
      lastElectionAt: new Date(),
    },
  });
}
