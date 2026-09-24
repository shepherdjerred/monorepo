import { tool } from "ai";
import { z } from "zod";
import {
  CompetitionIdSchema,
  CompetitionStatusSchema,
  DiscordGuildIdSchema,
  getCompetitionStatus,
  type CompetitionWithCriteria,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getCompetitionById,
  getCompetitionsByServerPaginated,
} from "#src/database/competition/queries.ts";
import {
  resolveCreationAccess,
  type CreationAccess,
} from "#src/explore/creation/capability.ts";
import { loadCachedLeaderboard } from "#src/storage/s3-leaderboard.ts";
import { serverNames } from "#src/explore/tools/hall-tools.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Reading a server's competitions — what is running, what finished, who won.
 *
 * Competitions are a core feature: the app offers these questions to anyone
 * with a server, and Explore could answer none of them. It had a tool to
 * prepare a competition and nothing to read one, and the two ScoutQL
 * competition sources are forbidden here, so "show the standings for our
 * active competition" was declined in every server that had one.
 *
 * Access follows the web app exactly. Every competition read there is
 * `guildProcedure("competitions", "read")`: an explicit grant, or a Discord
 * owner or administrator. The same resolution the creation tools use answers
 * it, lazily and once per turn, and an unreachable Discord stays distinct
 * from a refusal — "Scout could not check" is never "you lack permission".
 */

export const CompetitionReadResultSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

type ReadableGuilds =
  | { kind: "ok"; guildIds: DiscordGuildId[]; denied: DiscordGuildId[] }
  | { kind: "unavailable"; message: string };

function readableGuilds(
  access: CreationAccess,
  inScope: readonly DiscordGuildId[],
): ReadableGuilds {
  if (access.kind === "verification_unavailable") {
    return { kind: "unavailable", message: access.message };
  }
  const allowed = new Set(
    access.guilds
      .filter((guild) => guild.permissions.can("competitions", "read"))
      .map((guild) => guild.guildId),
  );
  return {
    kind: "ok",
    guildIds: inScope.filter((guildId) => allowed.has(guildId)),
    denied: inScope.filter((guildId) => !allowed.has(guildId)),
  };
}

function competitionSummary(
  competition: CompetitionWithCriteria,
  participants: number | null,
  server: string,
) {
  return {
    competitionId: competition.id,
    server,
    title: competition.title,
    description: competition.description,
    status: CompetitionStatusSchema.parse(getCompetitionStatus(competition)),
    scoring: competition.criteria.type,
    startDate: competition.startDate?.toISOString() ?? null,
    endDate: competition.endDate?.toISOString() ?? null,
    participants,
  };
}

export const ListCompetitionsInputSchema = z.strictObject({
  activeOnly: z.boolean().optional(),
  includeLeaders: z
    .boolean()
    .optional()
    .describe(
      "Also read each competition's current or final first place. Slower; use for winners and 'who won the most'.",
    ),
});

export const CompetitionStandingsInputSchema = z.strictObject({
  competitionId: CompetitionIdSchema,
  limit: z.number().int().min(1).max(50).optional(),
});

const DENIED_MESSAGE =
  "The user lacks the competitions:read permission in some servers in scope, so those were not read. Say so if the answer might be missing them; a server admin can grant it.";

export type CompetitionReadDependencies = {
  /** The user's per-guild permissions, resolved as the web app resolves them. */
  readonly resolveAccess: (input: {
    readonly guildIds: readonly DiscordGuildId[];
    readonly requesterId: DiscordAccountId;
  }) => Promise<CreationAccess>;
  readonly loadLeaderboard: typeof loadCachedLeaderboard;
};

export const defaultCompetitionReadDependencies: CompetitionReadDependencies = {
  resolveAccess: (input) =>
    resolveCreationAccess({
      capability: { guildIds: input.guildIds },
      requesterId: input.requesterId,
    }),
  loadLeaderboard: loadCachedLeaderboard,
};

export function createCompetitionReadTools(
  options: {
    readonly db: ExtendedPrismaClient;
    readonly requesterId: DiscordAccountId;
    readonly guildIds: readonly string[];
    readonly track: ToolTracker;
  },
  dependencies: CompetitionReadDependencies = defaultCompetitionReadDependencies,
) {
  const inScope = options.guildIds.map((guildId) =>
    DiscordGuildIdSchema.parse(guildId),
  );
  let access: Promise<CreationAccess> | undefined;
  const resolveAccess = async (): Promise<ReadableGuilds> => {
    access ??= dependencies.resolveAccess({
      guildIds: inScope,
      requesterId: options.requesterId,
    });
    return readableGuilds(await access, inScope);
  };

  return {
    list_competitions: tool({
      description:
        "List a server's competitions — active, upcoming, ended or cancelled — with scoring, dates, participant counts and, when asked, each one's leader or winner. Use for any question about which competitions exist, finished, won, or are scheduled.",
      // No server input, for the same reason as the Hall tool: the model never
      // sees guild ids, so it could only guess one. Results name the server.
      inputSchema: ListCompetitionsInputSchema,
      outputSchema: CompetitionReadResultSchema,
      execute: (input) =>
        options.track("list_competitions", async () => {
          const readable = await resolveAccess();
          if (readable.kind === "unavailable") {
            return {
              kind: "competitions_unverified",
              message: readable.message,
              data: [],
            };
          }
          const guildIds = readable.guildIds;
          const names = await serverNames(options.db, guildIds);
          const pages = await Promise.all(
            guildIds.map((guildId) =>
              getCompetitionsByServerPaginated(options.db, guildId, {
                activeOnly: input.activeOnly ?? false,
                limit: 50,
              }),
            ),
          );
          const competitions = pages.flatMap((page) => page.items);
          const counts = await options.db.competitionParticipant.groupBy({
            by: ["competitionId"],
            where: {
              competitionId: { in: competitions.map((entry) => entry.id) },
              status: { not: "LEFT" },
            },
            _count: { _all: true },
          });
          const countById = new Map(
            counts.map((row) => [row.competitionId, row._count._all]),
          );
          const data = await Promise.all(
            competitions.map(async (competition) => {
              const summary = competitionSummary(
                competition,
                countById.get(competition.id) ?? 0,
                names.get(competition.serverId) ?? competition.serverId,
              );
              if (input.includeLeaders !== true) return summary;
              const board = await dependencies.loadLeaderboard(competition.id);
              const first = board?.entries.find((entry) => entry.rank === 1);
              return {
                ...summary,
                leader:
                  first === undefined
                    ? null
                    : { player: first.playerName, score: first.score },
              };
            }),
          );
          return {
            kind: "competitions",
            message: [
              data.length === 0
                ? "No competitions were found in the servers the user can read."
                : "These are the servers' competitions. A leader of null means no standings have been computed yet.",
              ...(readable.denied.length === 0 ? [] : [DENIED_MESSAGE]),
            ].join(" "),
            data,
          };
        }),
    }),
    get_competition_standings: tool({
      description:
        "Read one competition's current standings (or final standings once it has ended), ranked. Call list_competitions first to find its id.",
      inputSchema: CompetitionStandingsInputSchema,
      outputSchema: CompetitionReadResultSchema,
      execute: (input) =>
        options.track("get_competition_standings", async () => {
          const readable = await resolveAccess();
          if (readable.kind === "unavailable") {
            return {
              kind: "competitions_unverified",
              message: readable.message,
              data: null,
            };
          }
          const competition = await getCompetitionById(
            options.db,
            input.competitionId,
          );
          // An id from a server the user cannot read is reported exactly like
          // one that does not exist, so the tool never confirms a competition
          // the user has no right to see.
          if (
            competition === undefined ||
            !readable.guildIds.includes(competition.serverId)
          ) {
            return {
              kind: "competition_not_found",
              message:
                "No competition with that id is readable by this user. Call list_competitions for the ones they can see.",
              data: null,
            };
          }
          const board = await dependencies.loadLeaderboard(competition.id);
          const names = await serverNames(options.db, [competition.serverId]);
          return {
            kind: "competition_standings",
            message:
              board === null
                ? "Standings have not been computed for this competition yet. Say that, rather than that nobody is playing."
                : `Standings as of ${board.calculatedAt}.`,
            data: {
              competition: competitionSummary(
                competition,
                null,
                names.get(competition.serverId) ?? competition.serverId,
              ),
              calculatedAt: board?.calculatedAt ?? null,
              entries:
                board?.entries.slice(0, input.limit ?? 10).map((entry) => ({
                  rank: entry.rank,
                  player: entry.playerName,
                  score: entry.score,
                })) ?? [],
            },
          };
        }),
    }),
  };
}
