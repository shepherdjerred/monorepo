import { tool } from "ai";
import { z } from "zod";
import {
  CompetitionIdSchema,
  CompetitionStatusSchema,
  DiscordGuildIdSchema,
  getCompetitionStatus,
  type CompetitionWithCriteria,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  getCompetitionById,
  getCompetitionsByServerPaginated,
} from "#src/database/competition/queries.ts";
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
 * Access is membership. Every member of a server holds the implicit Player
 * role, which includes competitions:read, and a turn's servers are already
 * verified memberships — the web session's OAuth guild list, or the server a
 * Discord command or voice session runs in. So every server in the turn is
 * readable, with no per-turn Discord lookup: the lookup needed an OAuth grant
 * that Discord and voice turns never have, and made them answer "could not
 * verify your servers".
 */

export const CompetitionReadResultSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

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

export type CompetitionReadDependencies = {
  readonly loadLeaderboard: typeof loadCachedLeaderboard;
};

export const defaultCompetitionReadDependencies: CompetitionReadDependencies = {
  loadLeaderboard: loadCachedLeaderboard,
};

export function createCompetitionReadTools(
  options: {
    readonly db: ExtendedPrismaClient;
    readonly guildIds: readonly string[];
    readonly track: ToolTracker;
  },
  dependencies: CompetitionReadDependencies = defaultCompetitionReadDependencies,
) {
  const inScope = options.guildIds.map((guildId) =>
    DiscordGuildIdSchema.parse(guildId),
  );
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
          const guildIds = inScope;
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
            message:
              data.length === 0
                ? "No competitions were found in the user's servers."
                : "These are the servers' competitions. A leader of null means no standings have been computed yet.",
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
          const competition = await getCompetitionById(
            options.db,
            input.competitionId,
          );
          // An id from a server outside the turn is reported exactly like one
          // that does not exist, so the tool never confirms a competition in a
          // server the user is not in.
          if (
            competition === undefined ||
            !inScope.includes(competition.serverId)
          ) {
            return {
              kind: "competition_not_found",
              message:
                "No competition with that id is in the user's servers. Call list_competitions for the ones they can see.",
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
