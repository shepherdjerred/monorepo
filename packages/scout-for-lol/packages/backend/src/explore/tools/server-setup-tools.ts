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
import { TRPCError } from "@trpc/server";
import type { PermissionSet } from "@scout-for-lol/data";
import { activeOnlyWhere } from "#src/database/competition/queries.ts";
import { resolveGuildPermissionsForMember } from "#src/trpc/guild-permission.ts";
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
    options: { readonly needsAttachments: boolean },
  ) => Promise<PostableChannel[]>;
  /** The asker's dashboard grants in one server, resolved by Scout's bot. */
  readonly resolvePermissions: (
    requesterId: DiscordAccountId,
    guildId: DiscordGuildId,
  ) => Promise<PermissionSet>;
};

/** Each channel an unmuted feed posts to, from when the first was created. */
function activeFeedChannels<Channel>(
  players: readonly {
    subscriptions: readonly {
      channelId: Channel;
      isMuted: boolean;
      createdTime: Date;
    }[];
  }[],
): { channelId: Channel; since: Date }[] {
  const since = new Map<Channel, Date>();
  for (const feed of players.flatMap((player) => player.subscriptions)) {
    if (feed.isMuted) continue;
    const known = since.get(feed.channelId);
    if (known === undefined || feed.createdTime < known)
      since.set(feed.channelId, feed.createdTime);
  }
  return [...since].map(([channelId, from]) => ({ channelId, since: from }));
}

const defaultDependencies: ServerSetupDependencies = {
  listChannels: (guildId, options) =>
    listPostableChannels(guildId, undefined, options),
  resolvePermissions: resolveGuildPermissionsForMember,
};

/**
 * What the asker may see beyond the server's own existence.
 *
 * Feed destinations and the channel list sit behind `subscriptions:read` and
 * `channels:read` on the dashboard; membership alone does not grant them here
 * either. A failed lookup grants nothing extra.
 */
async function readGrants(
  dependencies: ServerSetupDependencies,
  requesterId: DiscordAccountId,
  guildId: DiscordGuildId,
): Promise<Grants> {
  try {
    const permissions = await dependencies.resolvePermissions(
      requesterId,
      guildId,
    );
    return {
      feeds: permissions.can("subscriptions", "read"),
      channels: permissions.can("channels", "read"),
      createReports: permissions.can("reports", "create"),
      checked: true,
    };
  } catch (error) {
    if (!(error instanceof TRPCError || error instanceof DiscordUpstreamError))
      throw error;
    // An outage hides the protected fields too, but must not read as a
    // denial: an admin is told to retry, not that they lack access.
    const unavailable =
      error instanceof DiscordUpstreamError ||
      error.code === "SERVICE_UNAVAILABLE" ||
      error.code === "UNAUTHORIZED";
    return {
      feeds: false,
      channels: false,
      createReports: false,
      checked: !unavailable,
    };
  }
}

type Grants = {
  readonly feeds: boolean;
  readonly channels: boolean;
  readonly createReports: boolean;
  /** False when Discord could not be asked, so nothing above is a denial. */
  readonly checked: boolean;
};

const PERMISSIONS_UNCHECKED =
  "hidden because Discord could not be reached to check your permissions; try again shortly";

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

function reportLimitText(
  limit: { readonly atLimit: boolean; readonly limitMessage: string | null },
  grants: Grants,
): string | null {
  if (limit.atLimit) return limit.limitMessage;
  if (grants.createReports) return "The asker can create another report here.";
  return grants.checked
    ? "Under the report limit, but the asker lacks the reports:create permission here."
    : "Under the report limit; whether the asker may create reports could not be checked.";
}

function channelList(
  grants: Grants,
  postable: ReadonlyMap<string, string> | null,
): string | string[] {
  if (!grants.channels)
    return `Channels are ${grants.checked ? "listed only with the channels:read permission" : PERMISSIONS_UNCHECKED}.`;
  return postable === null
    ? "Discord could not be reached to list channels."
    : [...postable.values()].map((name) => `#${name}`);
}

/**
 * Channels Scout can post in but not attach files to. Every match report
 * carries an image, so a feed there fails; a report fails only if it renders
 * a chart, so the finding says which ones.
 */
function attachmentFindings(input: {
  readonly feedsWithoutFiles?: number;
  readonly reportsWithoutFiles?: number;
}): string[] {
  const findings: string[] = [];
  const feeds = input.feedsWithoutFiles ?? 0;
  const reports = input.reportsWithoutFiles ?? 0;
  if (feeds > 0)
    findings.push(
      `${feeds.toString()} feed(s) post to a channel where Scout cannot attach files. Match reports carry an image, so they fail there until an admin grants Scout Attach Files.`,
    );
  if (reports > 0)
    findings.push(
      `${reports.toString()} scheduled report(s) post to a channel where Scout cannot attach files. Chart reports there fail until an admin grants Scout Attach Files; text reports still post.`,
    );
  return findings;
}

/** The plain-words diagnosis a setup answer leads with. */
export function setupFindings(input: {
  readonly trackedPlayers: number;
  readonly feeds: number;
  readonly mutedFeeds: number;
  readonly unreachableFeeds: number;
  readonly unreachableReports: number;
  /** Feeds in a channel Scout can post in but not attach the report image. */
  readonly feedsWithoutFiles?: number;
  /** Reports in a channel Scout can post in but not attach a chart. */
  readonly reportsWithoutFiles?: number;
  /** Discord could not be asked which channels Scout can post in. */
  readonly accessUnverified: boolean;
  readonly lastMatchPost: Date | null;
}): readonly string[] {
  const findings: string[] = [];
  // Reports are their own feature: their findings stand even when no players
  // are tracked.
  if (input.trackedPlayers === 0) {
    findings.push(
      "This server tracks no players, so Scout has no games to post match reports for. Tracking a player with a feed in a channel fixes that.",
    );
  } else if (input.feeds === 0) {
    findings.push(
      "Players are tracked but none has a feed, so Scout posts nothing after their games. Adding a feed to a channel fixes that.",
    );
  } else if (input.mutedFeeds === input.feeds) {
    findings.push(
      "Every feed on this server is muted, so Scout posts nothing after games. Unmuting a feed on the Subscriptions page fixes that.",
    );
  } else if (input.mutedFeeds > 0) {
    findings.push(
      `${input.mutedFeeds.toString()} of ${input.feeds.toString()} feeds are muted; each muted feed posts nothing to its channel.`,
    );
  }
  if (input.accessUnverified) {
    findings.push(
      "Discord could not be reached to check which channels Scout can post in, so delivery is unverified. Say so rather than calling the setup complete.",
    );
  }
  if (input.unreachableReports > 0) {
    findings.push(
      `${input.unreachableReports.toString()} scheduled report(s) post to a channel Scout can no longer post in; an admin must restore access or move them.`,
    );
  }
  if (input.unreachableFeeds > 0) {
    findings.push(
      `${input.unreachableFeeds.toString()} feed(s) point at a channel Scout can no longer post in; an admin must restore Scout's access or move the feed.`,
    );
  }
  findings.push(...attachmentFindings(input));
  if (
    input.trackedPlayers > 0 &&
    input.feeds > input.mutedFeeds &&
    input.lastMatchPost === null
  ) {
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
    const [names, players, reports, activeCompetitions, reportLimit, grants] =
      await Promise.all([
        serverNames(db, [guildId]),
        db.player.findMany({
          where: { serverId: guildId },
          include: {
            accounts: { select: { riotGameName: true, riotTagLine: true } },
            subscriptions: {
              select: {
                channelId: true,
                isMuted: true,
                filters: true,
                createdTime: true,
              },
            },
          },
          orderBy: { alias: "asc" },
        }),
        db.report.findMany({
          where: { serverId: guildId, isSystemManaged: false },
          orderBy: { createdTime: "asc" },
        }),
        db.competition.count({
          where: { serverId: guildId, ...activeOnlyWhere(new Date()) },
        }),
        previewReportLimit(db, { guildId, ownerId: options.requesterId }),
        readGrants(dependencies, options.requesterId, guildId),
      ]);

    // Where Scout can post at all, and where it can also attach files.
    let postable: Map<string, string> | null;
    let withFiles: ReadonlySet<string> = new Set();
    try {
      const [channels, imageChannels] = await Promise.all([
        dependencies.listChannels(guildId, { needsAttachments: false }),
        dependencies.listChannels(guildId, { needsAttachments: true }),
      ]);
      postable = new Map(channels.map((channel) => [channel.id, channel.name]));
      withFiles = new Set(imageChannels.map((channel) => channel.id));
    } catch (error) {
      if (!(error instanceof DiscordUpstreamError)) throw error;
      postable = null;
    }

    // Only a delivered match report counts: dares, duels and announcements
    // share this table and channel. It must also be from a current feed:
    // only unmuted ones, and only since the earliest of them in that channel
    // was created, so a deleted or muted feed's old post cannot hide that the
    // active feeds have never delivered.
    const lastPost = await db.matchNotificationIntent.findFirst({
      where: {
        targetKind: "channel",
        OR: activeFeedChannels(players).map((feed) => ({
          targetId: feed.channelId,
          deliveredAt: { gte: feed.since },
        })),
        state: "delivered",
        subjectKind: "match",
        kind: "postmatch",
      },
      orderBy: { deliveredAt: "desc" },
      select: { deliveredAt: true },
    });
    const feeds = players.flatMap((player) => player.subscriptions);
    const unreachableFeeds =
      postable === null
        ? 0
        : // A muted feed is not trying to post; its channel is not a fault.
          feeds.filter((feed) => !feed.isMuted && !postable.has(feed.channelId))
            .length;
    const unreachableReports =
      postable === null
        ? 0
        : reports.filter(
            (report) => report.isEnabled && !postable.has(report.channelId),
          ).length;
    const withoutFiles = (channelId: string) =>
      postable !== null && postable.has(channelId) && !withFiles.has(channelId);
    const feedsWithoutFiles = feeds.filter(
      (feed) => !feed.isMuted && withoutFiles(feed.channelId),
    ).length;
    const reportsWithoutFiles = reports.filter(
      (report) => report.isEnabled && withoutFiles(report.channelId),
    ).length;
    const lastMatchPost = lastPost?.deliveredAt ?? null;
    const findings = setupFindings({
      trackedPlayers: players.length,
      feeds: feeds.length,
      mutedFeeds: feeds.filter((feed) => feed.isMuted).length,
      unreachableFeeds,
      unreachableReports,
      feedsWithoutFiles,
      reportsWithoutFiles,
      accessUnverified: postable === null,
      lastMatchPost,
    });
    // Channel names need channels:read; feed destinations need
    // subscriptions:read as well.
    const label = (channelId: string) =>
      grants.channels ? channelLabel(channelId, postable) : "a channel";

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
            feeds: grants.feeds
              ? player.subscriptions.map((feed) => ({
                  channel: label(feed.channelId),
                  muted: feed.isMuted,
                  queueFilters: feed.filters,
                }))
              : `${player.subscriptions.length.toString()} feed(s); their channels are ${grants.checked ? "visible with the subscriptions:read permission" : PERMISSIONS_UNCHECKED}`,
          })),
        },
        reports: reports.map((report) => ({
          title: report.title,
          channel: label(report.channelId),
          enabled: report.isEnabled,
          schedule: `${report.cronExpression} (${report.scheduleTimezone})`,
          ownedByAsker: report.ownerId === options.requesterId,
        })),
        reportLimitForAsker: reportLimitText(reportLimit, grants),
        activeCompetitions,
        postableChannels: channelList(grants, postable),
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
      if (only === undefined) {
        return ServerSetupResultSchema.parse({
          kind: "unavailable",
          message:
            "No server is in scope for this turn, so there is no setup to read.",
          data: null,
        });
      }
      if (others.length > 0) {
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
