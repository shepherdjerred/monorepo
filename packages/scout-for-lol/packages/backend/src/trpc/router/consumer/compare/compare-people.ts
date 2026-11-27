import { TRPCError } from "@trpc/server";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { notFound } from "#src/lib/player-admin/shared.ts";
import { groupPeople } from "#src/lib/player-profile/roster.ts";
import type { CommunityPlayer } from "#src/trpc/router/consumer/community-insights.ts";

/**
 * One side of the comparison: the person the requested player row belongs to.
 * A person tracked in several servers is several player rows, and one with
 * several Riot accounts is one row with several; every account is counted
 * once, under the requested row's id.
 */
export type ComparedPerson = CommunityPlayer & {
  isYou: boolean;
  puuids: LeaguePuuid[];
};

/**
 * Resolve both players within the viewer's servers. A player outside them is
 * not found, exactly as on the player page; two rows of one person are not a
 * comparison.
 */
export async function resolveComparedPeople(input: {
  guildIds: DiscordGuildId[];
  leftId: number;
  rightId: number;
  viewerDiscordId: DiscordAccountId;
}): Promise<[ComparedPerson, ComparedPerson]> {
  const players = await prisma.player.findMany({
    where: { serverId: { in: input.guildIds } },
    select: {
      id: true,
      alias: true,
      serverId: true,
      discordId: true,
      accounts: {
        select: {
          id: true,
          puuid: true,
          riotGameName: true,
          riotTagLine: true,
          region: true,
        },
      },
    },
  });
  const people = groupPeople(players);
  const groupOf = (playerId: number) => {
    const members = people.find((group) =>
      group.some((member) => member.id === playerId),
    );
    const requested = members?.find((member) => member.id === playerId);
    if (members === undefined || requested === undefined) {
      throw notFound("Player was not found");
    }
    return { members, requested };
  };
  const left = groupOf(input.leftId);
  const right = groupOf(input.rightId);
  if (left.members === right.members) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose two different players.",
    });
  }
  const person = (side: typeof left): ComparedPerson => {
    const accounts = [
      ...new Map(
        side.members
          .flatMap((member) => member.accounts)
          .map((account) => [account.puuid, account] as const),
      ).values(),
    ];
    return {
      id: side.requested.id,
      alias: side.requested.alias,
      accounts,
      puuids: accounts.map((account) => account.puuid),
      isYou: side.members.some(
        (member) => member.discordId === input.viewerDiscordId,
      ),
    };
  };
  return [person(left), person(right)];
}
