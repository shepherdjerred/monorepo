import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { latestRanksByPuuid } from "#src/lib/player-profile/profile-resolution.ts";
import { readGuildMatchRows } from "#src/reports/duckdb/community/community-lake.ts";
import { withLakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import {
  buildCommunityInsights,
  COMMUNITY_PLAYER_SELECT,
} from "#src/trpc/router/consumer/community-insights.ts";
import { buildAwards } from "#src/trpc/router/consumer/server/server-awards.ts";
import {
  buildDuos,
  buildPlays,
} from "#src/trpc/router/consumer/server/server-duos-plays.ts";
import { buildLadder } from "#src/trpc/router/consumer/server/server-ladder.ts";
import { loadWeeklyLpClimbs } from "#src/trpc/router/consumer/server/server-lp-climb.ts";

const DAY_MS = 86_400_000;
/** Awards cover the last week. */
export const AWARD_WINDOW_DAYS = 7;
/** Duos and plays cover the same 90 days as the community overview. */
export const SERVER_SCAN_DAYS = 90;

/**
 * One Discord server's community view: its ladder, the week's awards, its
 * duos and what it plays. Derived per request from one bounded guild scan (one
 * lake slot), `latestRanksByPuuid` and `MatchRankHistory`; nothing is stored.
 */
export async function getGuildServerPage(input: {
  guild: { id: string; name: string };
  viewerDiscordId: DiscordAccountId;
  nowMs: number;
}) {
  const { viewerDiscordId } = input;
  const players = await prisma.player.findMany({
    where: { serverId: DiscordGuildIdSchema.parse(input.guild.id) },
    select: { ...COMMUNITY_PLAYER_SELECT, discordId: true },
  });
  const puuids = [
    ...new Set(
      players.flatMap((player) =>
        player.accounts.map((account) => account.puuid),
      ),
    ),
  ];
  const weekStartMs = input.nowMs - AWARD_WINDOW_DAYS * DAY_MS;
  // All queues: a game is a game for the week's awards. The insights keep
  // only standard five-versus-five games for duos and plays.
  const rows =
    puuids.length === 0
      ? []
      : await withLakePage(
          undefined,
          async (page) =>
            await readGuildMatchRows(page, {
              puuids,
              afterMs: input.nowMs - SERVER_SCAN_DAYS * DAY_MS,
            }),
        );
  const [ranks, climbs] = await Promise.all([
    latestRanksByPuuid(puuids),
    loadWeeklyLpClimbs(players, weekStartMs),
  ]);
  const insights = buildCommunityInsights({
    players,
    rows,
    allTimeAccounts: [],
    standardOnly: true,
  });
  return {
    guild: { id: input.guild.id, name: input.guild.name },
    ladder: buildLadder({ players, ranks, viewerDiscordId }),
    awards: buildAwards({
      players,
      rows,
      climbs,
      sinceMs: weekStartMs,
      viewerDiscordId,
    }),
    duos: buildDuos({ pairs: insights.pairs, players, viewerDiscordId }),
    plays: buildPlays({ coverage: insights.coverage, rows }),
  };
}
