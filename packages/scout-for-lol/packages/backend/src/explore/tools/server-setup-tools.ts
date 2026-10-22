import { tool } from "ai";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { getGuildPageUrl } from "#src/discord/commands/links.ts";
import { previewReportLimit } from "#src/explore/creation/limits.ts";
import { serverNames } from "#src/explore/tools/hall-tools.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import {
  listPostableChannels,
  type PostableChannel,
} from "#src/lib/discord/postable-channels.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * What one of the asker's servers has set up, for setup and troubleshooting.
 *
 * The questions new users bring most are about Scout itself, not the data:
 * "why no match report", "show my active reports", "what can I set up here".
 * In prod Explore answered the first with a random match from another server
 * and the second with "I can't list your reports", because nothing it could
 * call knew what a server had. This reads it — tracked players, their feeds,
 * reports and their limit, competitions, the channels Scout can post in, and
 * when a match report last went out — and says in plain words what is
 * missing.
 *
 * Read-only, and only for servers already in the turn's scope.
 */

/** Enough players to answer setup questions without dumping a roster. */
const MAX_LISTED_PLAYERS = 25;

export const GetServerSetupInputSchema = z.strictObject({
  server: DiscordGuildIdSchema.nullable().describe(
    "The server to read. null when only one server is in scope.",
  ),
});

export const ServerSetupResultSchema = z.strictObject({
  kind: z.enum(["server_setup", "choose_server", "unavailable"]),
  message: z.string(),
  data: z.unknown(),
});
export type ServerSetupResult = z.infer<typeof ServerSetupResultSchema>;

export type ServerSetupDependencies = {
  readonly listChannels: (
    guildId: DiscordGuildId,
  ) => Promise<PostableChannel[]>;
};

const defaultDependencies: ServerSetupDependencies = {
  listChannels: listPostableChannels,
};

function channelLabel(
  channelId: string,
  postable: ReadonlyMap<string, string> | null,
): string {
  if (postable === null) return `channel ${channelId}`;
  const name = postable.get(channelId);
  return name === undefined
    ? `a channel Scout can no longer post in (${channelId})`
    : `#${name}`;
}

/** The plain-words diagnosis a setup answer leads with. */
export function setupFindings(input: {
  readonly trackedPlayers: number;
  readonly feeds: number;
  readonly unreachableFeeds: number;
  readonly lastMatchPost: Date | null;
}): readonly string[] {
  if (input.trackedPlayers === 0) {
    return [
      "This server tracks no players, so Scout has no games to post match reports for. Tracking a player with a feed in a channel fixes that.",
    ];
  }
  const findings: string[] = [];
  if (input.feeds === 0) {
    findings.push(
      "Players are tracked but none has a feed, so Scout posts nothing after their games. Adding a feed to a channel fixes that.",
    );
  }
  if (input.unreachableFeeds > 0) {
    findings.push(
      `${input.unreachableFeeds.toString()} feed(s) point at a channel Scout can no longer post in; an admin must restore Scout's access or move the feed.`,
    );
  }
  if (input.feeds > 0 && input.lastMatchPost === null) {
    findings.push(
      "No match report has been delivered from these feeds yet. Reports post after a tracked player finishes a game Scout records.",
    );
  }
  return findings;
}

/**
 * The executor behind `get_server_setup`, separate from the AI-SDK wrapper so
 * tests can drive it without constructing tool execution options.
 */
export function createServerSetupExecutor(
  options: {
    readonly db: ExtendedPrismaClient;
    readonly guildIds: readonly DiscordGuildId[];
    readonly requesterId: DiscordAccountId;
  },
  dependencies: ServerSetupDependencies = defaultDependencies,
): (
  input: z.infer<typeof GetServerSetupInputSchema>,
) => Promise<ServerSetupResult> {
  const inScope = options.guildIds.map((guildId) =>
    DiscordGuildIdSchema.parse(guildId),
  );

  async function readSetup(
    guildId: DiscordGuildId,
  ): Promise<ServerSetupResult> {
    const { db } = options;
    const [names, players, reports, activeCompetitions, reportLimit] =
      await Promise.all([
        serverNames(db, [guildId]),
        db.player.findMany({
          where: { serverId: guildId },
          include: {
            accounts: { select: { riotGameName: true, riotTagLine: true } },
            subscriptions: { select: { channelId: true } },
          },
          orderBy: { alias: "asc" },
        }),
        db.report.findMany({
          where: { serverId: guildId, isSystemManaged: false },
          orderBy: { createdTime: "asc" },
        }),
        db.competition.count({
          where: { serverId: guildId, isCancelled: false },
        }),
        previewReportLimit(db, { guildId, ownerId: options.requesterId }),
      ]);

    let postable: Map<string, string> | null;
    try {
      const channels = await dependencies.listChannels(guildId);
      postable = new Map(channels.map((channel) => [channel.id, channel.name]));
    } catch (error) {
      if (!(error instanceof DiscordUpstreamError)) throw error;
      postable = null;
    }

    const feedChannelIds = [
      ...new Set(
        players.flatMap((player) =>
          player.subscriptions.map((feed) => feed.channelId),
        ),
      ),
    ];
    const lastPost = await db.matchNotificationIntent.findFirst({
      where: {
        targetKind: "channel",
        targetId: { in: feedChannelIds },
        state: "delivered",
      },
      orderBy: { deliveredAt: "desc" },
      select: { deliveredAt: true },
    });
    const feeds = players.flatMap((player) => player.subscriptions);
    const unreachableFeeds =
      postable === null
        ? 0
        : feeds.filter((feed) => !postable.has(feed.channelId)).length;
    const lastMatchPost = lastPost?.deliveredAt ?? null;
    const findings = setupFindings({
      trackedPlayers: players.length,
      feeds: feeds.length,
      unreachableFeeds,
      lastMatchPost,
    });

    return ServerSetupResultSchema.parse({
      kind: "server_setup",
      message:
        findings.length === 0
          ? "Setup looks complete. Answer from these facts; name only the pages listed."
          : `Lead with these findings: ${findings.join(" ")}`,
      data: {
        server: names.get(guildId) ?? guildId,
        trackedPlayers: {
          count: players.length,
          players: players.slice(0, MAX_LISTED_PLAYERS).map((player) => ({
            alias: player.alias,
            linkedToAsker: player.discordId === options.requesterId,
            riotIds: player.accounts.flatMap((account) =>
              account.riotGameName === null || account.riotTagLine === null
                ? []
                : [`${account.riotGameName}#${account.riotTagLine}`],
            ),
            feeds: player.subscriptions.map((feed) =>
              channelLabel(feed.channelId, postable),
            ),
          })),
        },
        reports: reports.map((report) => ({
          title: report.title,
          channel: channelLabel(report.channelId, postable),
          enabled: report.isEnabled,
          schedule: `${report.cronExpression} (${report.scheduleTimezone})`,
          ownedByAsker: report.ownerId === options.requesterId,
        })),
        reportLimitForAsker: reportLimit.atLimit
          ? reportLimit.limitMessage
          : "The asker can create another report here.",
        activeCompetitions,
        postableChannels:
          postable === null
            ? "Discord could not be reached to list channels."
            : [...postable.values()].map((name) => `#${name}`),
        lastMatchPost: lastMatchPost?.toISOString() ?? null,
        findings,
        pages: {
          players: getGuildPageUrl(guildId, "players"),
          subscriptions: getGuildPageUrl(guildId, "subscriptions"),
          reports: getGuildPageUrl(guildId, "reports"),
          competitions: getGuildPageUrl(guildId, "competitions"),
        },
      },
    });
  }

  return async (input) => {
    if (input.server === null) {
      const [only, ...others] = inScope;
      if (only === undefined || others.length > 0) {
        return ServerSetupResultSchema.parse({
          kind: "choose_server",
          message:
            "More than one server is in scope. Ask which server they mean, or call list_my_servers.",
          data: null,
        });
      }
      return await readSetup(only);
    }
    if (!inScope.includes(input.server)) {
      return ServerSetupResultSchema.parse({
        kind: "unavailable",
        message: "That server is not one of the asker's servers in scope.",
        data: null,
      });
    }
    return await readSetup(input.server);
  };
}

export function createServerSetupTools(
  options: {
    readonly db: ExtendedPrismaClient;
    readonly guildIds: readonly DiscordGuildId[];
    readonly requesterId: DiscordAccountId;
    readonly track: ToolTracker;
  },
  dependencies: ServerSetupDependencies = defaultDependencies,
) {
  const execute = createServerSetupExecutor(options, dependencies);
  return {
    get_server_setup: tool({
      description:
        "Read what one of the asker's servers has set up: tracked players and their feeds, scheduled reports and the asker's report limit, active competitions, the channels Scout can post in, when a match report was last delivered, and the web pages that manage each. Use it for any setup or troubleshooting question — why nothing is posting, what reports exist, what can be added — before answering.",
      inputSchema: GetServerSetupInputSchema,
      outputSchema: ServerSetupResultSchema,
      execute: (input) =>
        options.track("get_server_setup", async () => await execute(input)),
    }),
  };
}
