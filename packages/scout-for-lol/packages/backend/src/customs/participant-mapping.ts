import type {
  CustomNightParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { DiscordGuildIdSchema, type CustomAccount } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

export async function refreshCustomParticipantMappings(params: {
  prisma: ExtendedPrismaClient;
  snapshot: CustomNightSnapshot;
}): Promise<CustomNightParticipant[]> {
  const discordIds = params.snapshot.participants.map(
    (participant) => participant.discordId,
  );
  if (discordIds.length === 0) return [...params.snapshot.participants];

  const players = await params.prisma.player.findMany({
    where: {
      serverId: DiscordGuildIdSchema.parse(params.snapshot.guildId),
      discordId: { in: discordIds },
    },
    include: { accounts: { where: { region: "AMERICA_NORTH" } } },
  });

  return params.snapshot.participants.map((participant) => {
    const matches = players.filter(
      (player) => player.discordId === participant.discordId,
    );
    if (matches.length > 1) {
      throw new Error(
        "This Discord account maps to multiple Scout players in the guild",
      );
    }
    const player = matches[0];
    const accounts: CustomAccount[] = (player?.accounts ?? []).map(
      (account) => ({
        accountId: account.id,
        puuid: account.puuid,
        region: "AMERICA_NORTH",
        riotGameName: account.riotGameName,
        riotTagLine: account.riotTagLine,
      }),
    );
    const selectedAccountId =
      participant.selectedAccountId !== null &&
      accounts.some(
        (account) => account.accountId === participant.selectedAccountId,
      )
        ? participant.selectedAccountId
        : accounts.length === 1
          ? (accounts[0]?.accountId ?? null)
          : null;

    return {
      ...participant,
      playerId: player?.id ?? null,
      playerAlias: player?.alias ?? null,
      accounts,
      selectedAccountId,
    };
  });
}
