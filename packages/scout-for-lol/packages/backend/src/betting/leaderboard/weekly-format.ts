import { formatInteger } from "@scout-for-lol/data";
import type { DiscordAccountId } from "@scout-for-lol/domain/identity/discord.ts";
import type { FullLeaderboardRow } from "#src/betting/accounts.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";

export type RankedLeaderboardRow = FullLeaderboardRow & { rank: number };
export type WeeklyBucksSuperlative = {
  discordId: DiscordAccountId;
  amount: number;
};
export type WeeklyBucksStats = {
  mostGained: WeeklyBucksSuperlative | null;
  mostLost: WeeklyBucksSuperlative | null;
  mostBetsWon: WeeklyBucksSuperlative | null;
  mostParlaysWon: WeeklyBucksSuperlative | null;
};

export function formatWeeklyBucksStats(stats: WeeklyBucksStats): string[] {
  const lines: string[] = [];
  if (stats.mostGained !== null)
    lines.push(
      `📈 Most gained: <@${stats.mostGained.discordId}> +${formatInteger(stats.mostGained.amount)} BB`,
    );
  if (stats.mostLost !== null)
    lines.push(
      `📉 Most lost: <@${stats.mostLost.discordId}> −${formatInteger(Math.abs(stats.mostLost.amount))} BB`,
    );
  if (stats.mostBetsWon !== null)
    lines.push(
      `🎯 Most bets won: <@${stats.mostBetsWon.discordId}> (${formatInteger(stats.mostBetsWon.amount)})`,
    );
  if (stats.mostParlaysWon !== null)
    lines.push(
      `🎲 Most parlays won: <@${stats.mostParlaysWon.discordId}> (${formatInteger(stats.mostParlaysWon.amount)})`,
    );
  return lines.length === 0 ? [] : ["📊 **This week**", ...lines];
}

export function rankBucksLeaderboard(
  rows: readonly FullLeaderboardRow[],
): RankedLeaderboardRow[] {
  let previousBalance: number | undefined;
  let rank = 0;
  return rows.map((row, index) => {
    if (previousBalance === undefined || row.balance !== previousBalance) {
      rank = index + 1;
      previousBalance = row.balance;
    }
    return { ...row, rank };
  });
}

export function formatWeeklyBucksLeaderboard(
  rows: readonly FullLeaderboardRow[],
  stats?: WeeklyBucksStats,
  maxLength?: number,
): string[] {
  if (rows.length === 0)
    return [
      "💰 **Weekly Bryan Bucks leaderboard**\nNo Bryan Bucks wallets exist yet.",
    ];
  const body = rankBucksLeaderboard(rows)
    .map(
      (row) =>
        `**${formatInteger(row.rank)}.** <@${row.discordId}> — **${formatInteger(row.balance)} BB**`,
    )
    .join("\n");
  const statsSection = stats === undefined ? [] : formatWeeklyBucksStats(stats);
  const statsSuffix =
    statsSection.length === 0 ? "" : `\n\n${statsSection.join("\n")}`;
  return splitMessageIntoChunks(
    `💰 **Weekly Bryan Bucks leaderboard**\n${body}${statsSuffix}`,
    maxLength,
  );
}
