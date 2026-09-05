import { describe, expect, test } from "vitest";
import type { MessageCreateOptions } from "discord.js";
import {
  DiscordGuildIdSchema,
  type DiscordChannelId,
} from "@scout-for-lol/data";
import type { FullLeaderboardRow } from "#src/betting/accounts.ts";
import {
  formatWeeklyBucksLeaderboard,
  formatWeeklyBucksStats,
  rankBucksLeaderboard,
  runWeeklyBucksLeaderboard,
  WEEKLY_BUCKS_CRON,
  type WeeklyBucksLeaderboardDependencies,
  type WeeklyBucksStats,
} from "#src/betting/weekly/weekly-leaderboard.ts";
import { COMMON_DENOMINATOR_CHANNEL_ID } from "#src/discord/channels.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const SERVER_ID = DiscordGuildIdSchema.parse("1337623164146155593");
const OTHER_SERVER_ID = DiscordGuildIdSchema.parse("2337623164146155593");

function row(index: number, balance: number): FullLeaderboardRow {
  return {
    accountId: index,
    discordId: bucksTestDiscordId(index),
    balance,
  };
}

const NO_STATS: WeeklyBucksStats = {
  mostGained: null,
  mostLost: null,
  mostBetsWon: null,
  mostParlaysWon: null,
};

function dependencies(input: {
  guilds?: ReturnType<typeof DiscordGuildIdSchema.parse>[];
  member?: boolean;
  rows?: FullLeaderboardRow[];
  stats?: WeeklyBucksStats;
  sendMessage?: WeeklyBucksLeaderboardDependencies["sendMessage"];
  persistSnapshot?: WeeklyBucksLeaderboardDependencies["persistSnapshot"];
}): WeeklyBucksLeaderboardDependencies {
  return {
    enabledGuilds: async () => input.guilds ?? [SERVER_ID],
    hasGuild: () => input.member ?? true,
    loadRows: () => Promise.resolve(input.rows ?? []),
    loadStats: () => Promise.resolve(input.stats ?? NO_STATS),
    persistSnapshot: input.persistSnapshot ?? (() => Promise.resolve()),
    sendMessage: input.sendMessage ?? (() => Promise.resolve(undefined)),
    sleep: () => Promise.resolve(),
  };
}

describe("weekly Bryan Bucks leaderboard", () => {
  test("is scheduled Friday at 5 PM Pacific and never on startup", () => {
    expect(WEEKLY_BUCKS_CRON).toEqual(
      expect.objectContaining({
        schedule: "0 0 17 * * 5",
        timezone: "America/Los_Angeles",
        runOnInit: false,
      }),
    );
  });

  test("uses competition ranks for ties and retains zero balances", () => {
    expect(
      rankBucksLeaderboard([row(1, 20), row(2, 20), row(3, 5), row(4, 0)]).map(
        (entry) => [entry.rank, entry.balance],
      ),
    ).toEqual([
      [1, 20],
      [1, 20],
      [3, 5],
      [4, 0],
    ]);
  });

  test("splits the complete list without dropping a wallet", () => {
    const rows = Array.from({ length: 20 }, (_unused, index) =>
      row(index + 1, 100 - index),
    );
    const chunks = formatWeeklyBucksLeaderboard(rows, undefined, 160);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 160)).toBe(true);
    const combined = chunks.join("\n");
    for (const entry of rows) {
      expect(combined).toContain(`<@${entry.discordId}>`);
    }
  });

  test("appends the weekly superlatives and omits empty lines", () => {
    const stats: WeeklyBucksStats = {
      mostGained: { discordId: bucksTestDiscordId(1), amount: 42 },
      mostLost: { discordId: bucksTestDiscordId(2), amount: -1250 },
      mostBetsWon: { discordId: bucksTestDiscordId(3), amount: 4 },
      mostParlaysWon: null,
    };
    const chunks = formatWeeklyBucksLeaderboard([row(1, 20)], stats);
    const combined = chunks.join("\n");
    expect(combined).toContain("📊 **This week**");
    expect(combined).toContain(
      `📈 Most gained: <@${bucksTestDiscordId(1)}> +42 BB`,
    );
    // Losses render as a positive magnitude with comma grouping.
    expect(combined).toContain(
      `📉 Most lost: <@${bucksTestDiscordId(2)}> −1,250 BB`,
    );
    expect(combined).toContain(
      `🎯 Most bets won: <@${bucksTestDiscordId(3)}> (4)`,
    );
    expect(combined).not.toContain("Most parlays won");
    // A week where nothing qualified adds no section at all.
    expect(formatWeeklyBucksStats(NO_STATS)).toEqual([]);
  });

  test("posts every chunk to the exact channel with mentions disabled", async () => {
    const sends: {
      options: MessageCreateOptions;
      channelId: DiscordChannelId;
      serverId: ReturnType<typeof DiscordGuildIdSchema.parse>;
    }[] = [];
    const rows = Array.from({ length: 80 }, (_unused, index) =>
      row(index + 1, 100 - index),
    );
    const result = await runWeeklyBucksLeaderboard(
      dependencies({
        rows,
        sendMessage: (options, channelId, serverId) => {
          sends.push({ options, channelId, serverId });
          return Promise.resolve(undefined);
        },
      }),
    );

    expect(result.status).toBe("sent");
    expect(result.entryCount).toBe(80);
    expect(sends).toHaveLength(result.chunkCount);
    expect(sends.length).toBeGreaterThan(1);
    for (const sent of sends) {
      expect(sent.channelId).toBe(COMMON_DENOMINATOR_CHANNEL_ID);
      expect(sent.serverId).toBe(SERVER_ID);
      expect(sent.options.allowedMentions).toEqual({ parse: [] });
      expect(sent.options.enforceNonce).toBe(true);
      expect(typeof sent.options.nonce).toBe("string");
    }
  });

  test("posts an explicit empty state", async () => {
    const messages: string[] = [];
    await runWeeklyBucksLeaderboard(
      dependencies({
        sendMessage: (options) => {
          if (options.content !== undefined) {
            messages.push(options.content);
          }
          return Promise.resolve(undefined);
        },
      }),
    );
    expect(messages).toEqual([
      expect.stringContaining("No Bryan Bucks wallets exist yet."),
    ]);
  });

  test("does nothing when this Discord application is not in the guild", async () => {
    let loaded = false;
    let sent = false;
    let persisted = false;
    const result = await runWeeklyBucksLeaderboard({
      ...dependencies({ member: false }),
      loadRows: () => {
        loaded = true;
        return Promise.resolve([]);
      },
      persistSnapshot: () => {
        persisted = true;
        return Promise.resolve();
      },
      sendMessage: () => {
        sent = true;
        return Promise.resolve(undefined);
      },
    });
    expect(result).toEqual({
      status: "not_in_guild",
      entryCount: 0,
      chunkCount: 0,
    });
    expect(loaded).toBe(false);
    expect(sent).toBe(false);
    expect(persisted).toBe(false);
  });

  test("fails closed unless exactly one guild is enabled", async () => {
    await expect(
      runWeeklyBucksLeaderboard(dependencies({ guilds: [] })),
    ).rejects.toThrow("requires exactly one enabled guild");
    await expect(
      runWeeklyBucksLeaderboard(
        dependencies({ guilds: [SERVER_ID, OTHER_SERVER_ID] }),
      ),
    ).rejects.toThrow("requires exactly one enabled guild");
  });

  test("retries transient failures idempotently", async () => {
    const options: MessageCreateOptions[] = [];
    let attempts = 0;
    const result = await runWeeklyBucksLeaderboard(
      dependencies({
        rows: [row(1, 10)],
        sendMessage: (message) => {
          options.push(message);
          attempts += 1;
          return attempts === 1
            ? Promise.reject(new Error("Discord delivery failed"))
            : Promise.resolve(undefined);
        },
      }),
    );

    expect(result.status).toBe("sent");
    expect(options).toHaveLength(2);
    expect(options[0]?.nonce).toBe(options[1]?.nonce);
    expect(options[0]?.enforceNonce).toBe(true);
  });

  test("attempts later chunks before surfacing a persistent failure", async () => {
    const deliveryError = new Error("Discord delivery failed");
    const attemptedContents: string[] = [];
    const rows = Array.from({ length: 80 }, (_unused, index) =>
      row(index + 1, 100 - index),
    );
    await expect(
      runWeeklyBucksLeaderboard(
        dependencies({
          rows,
          sendMessage: (options) => {
            if (options.content !== undefined) {
              attemptedContents.push(options.content);
            }
            return attemptedContents.length <= 3
              ? Promise.reject(deliveryError)
              : Promise.resolve(undefined);
          },
        }),
      ),
    ).rejects.toThrow("failed to deliver 1/");
    expect(attemptedContents.length).toBeGreaterThan(3);
    expect(attemptedContents.at(-1)).toContain(`<@${bucksTestDiscordId(80)}>`);
  });
});

describe("weekly Bryan Bucks leaderboard snapshot", () => {
  test("persists the exact ranked standings the post disclosed", async () => {
    const snapshots: Parameters<
      WeeklyBucksLeaderboardDependencies["persistSnapshot"]
    >[0][] = [];
    const result = await runWeeklyBucksLeaderboard(
      dependencies({
        rows: [row(1, 20), row(2, 20), row(3, 5)],
        persistSnapshot: (input) => {
          snapshots.push(input);
          return Promise.resolve();
        },
      }),
    );
    expect(result.status).toBe("sent");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.serverId).toBe(SERVER_ID);
    expect(Number.isInteger(snapshots[0]?.runWeek)).toBe(true);
    expect(snapshots[0]?.entries).toEqual([
      { rank: 1, discordId: bucksTestDiscordId(1), balance: 20 },
      { rank: 1, discordId: bucksTestDiscordId(2), balance: 20 },
      { rank: 3, discordId: bucksTestDiscordId(3), balance: 5 },
    ]);
  });

  test("a snapshot failure never blocks the Discord post", async () => {
    const sends: MessageCreateOptions[] = [];
    const result = await runWeeklyBucksLeaderboard(
      dependencies({
        rows: [row(1, 10)],
        persistSnapshot: () =>
          Promise.reject(new Error("snapshot storage unavailable")),
        sendMessage: (options) => {
          sends.push(options);
          return Promise.resolve(undefined);
        },
      }),
    );
    expect(result.status).toBe("sent");
    expect(sends).toHaveLength(1);
  });

  test("never persists when delivery fails, so the web never exposes an undisclosed snapshot", async () => {
    let persisted = false;
    const rows = Array.from({ length: 80 }, (_unused, index) =>
      row(index + 1, 100 - index),
    );
    await expect(
      runWeeklyBucksLeaderboard(
        dependencies({
          rows,
          persistSnapshot: () => {
            persisted = true;
            return Promise.resolve();
          },
          sendMessage: () =>
            Promise.reject(new Error("Discord delivery failed")),
        }),
      ),
    ).rejects.toThrow("failed to deliver");
    expect(persisted).toBe(false);
  });

  test("persists only after every chunk is confirmed delivered", async () => {
    const events: string[] = [];
    await runWeeklyBucksLeaderboard(
      dependencies({
        rows: [row(1, 10)],
        sendMessage: (options) => {
          events.push(`send:${options.content ?? ""}`);
          return Promise.resolve(undefined);
        },
        persistSnapshot: () => {
          events.push("persist");
          return Promise.resolve();
        },
      }),
    );
    expect(events.at(-1)).toBe("persist");
    expect(events.filter((event) => event === "persist")).toHaveLength(1);
  });
});
