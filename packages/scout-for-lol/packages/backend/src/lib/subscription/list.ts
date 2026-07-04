import { parseSubscriptionFilters } from "@scout-for-lol/data/index.ts";
import { prisma } from "#src/database/index.ts";
import type {
  ListSubscriptionsInput,
  SubscriptionListItem,
} from "#src/lib/subscription/types.ts";
import { resolveDiscordUsers } from "#src/lib/discord/resolve-users.ts";

export async function listSubscriptions(
  input: ListSubscriptionsInput,
): Promise<{ items: SubscriptionListItem[]; nextCursor: number | null }> {
  const rows = await prisma.subscription.findMany({
    where: { serverId: input.guildId },
    include: {
      player: { include: { accounts: true } },
    },
    // `id` is the stable tiebreaker required for correct cursor pagination.
    orderBy: [{ channelId: "asc" }, { createdTime: "asc" }, { id: "asc" }],
    take: input.limit + 1,
    ...(input.cursor === undefined
      ? {}
      : { cursor: { id: input.cursor }, skip: 1 }),
  });
  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;

  const names = await resolveDiscordUsers(
    page.flatMap((sub) => [
      sub.creatorDiscordId,
      ...(sub.player.discordId === null ? [] : [sub.player.discordId]),
    ]),
  );

  const items = page.map((sub) => ({
    subscriptionId: sub.id,
    channelId: sub.channelId,
    player: {
      id: sub.player.id,
      alias: sub.player.alias,
      discordId: sub.player.discordId,
      discordUser:
        sub.player.discordId === null
          ? null
          : (names[sub.player.discordId] ?? null),
      accounts: sub.player.accounts.map((a) => ({
        id: a.id,
        alias: a.alias,
        region: a.region,
        puuid: a.puuid,
        riotGameName: a.riotGameName,
        riotTagLine: a.riotTagLine,
      })),
    },
    creatorDiscordId: sub.creatorDiscordId,
    creatorDiscordUser: names[sub.creatorDiscordId] ?? null,
    createdTime: sub.createdTime,
    filters: parseSubscriptionFilters(sub.filters),
  }));

  // Cursor is the last returned row's id (next page resumes after it).
  return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}
