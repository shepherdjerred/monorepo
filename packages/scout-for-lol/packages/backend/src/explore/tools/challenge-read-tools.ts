import { tool } from "ai";
import { z } from "zod";
import {
  ChallengeRunStatusSchema,
  type ChallengeProgress,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { searchChallengeCatalog } from "#src/progression/challenges/catalog.ts";
import {
  getChallengeRun,
  getChallengeRunHistory,
} from "#src/progression/challenges/run-store.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

/**
 * Reading Scout challenges, as distinct from authoring them.
 *
 * Explore's challenge tools used to draft and preview only, so every question
 * about runs — "how close am I", "who has completed the most", "which
 * challenges does nobody finish" — was declined as unqueryable, while Scout
 * held every run, snapshot and completion in Postgres. These read that data
 * through the same services the web app uses.
 *
 * Visibility follows the web app. A member may see the runs of other players
 * in a server they share (`profileRuns`), so a server leaderboard is built
 * only from players registered in the servers in scope; nothing here reads a
 * run whose owner is outside them. The catalog is global in the web app too.
 */

/** One line of progress, not the whole tree: a distinct goal's covered list can run to every champion. */
export function progressSummary(progress: ChallengeProgress): string {
  switch (progress.kind) {
    case "scalar":
    case "distinct": {
      return `${progress.current.toString()} of ${progress.target.toString()}${progress.completed ? " (complete)" : ""}`;
    }
    case "boolean": {
      const done = progress.children.filter((child) => child.completed).length;
      return `${done.toString()} of ${progress.children.length.toString()} conditions met (${progress.operator === "all" ? "all" : "any one"} required)${progress.completed ? ", complete" : ""}`;
    }
  }
}

export const ChallengeCatalogInputSchema = z.strictObject({
  search: z
    .string()
    .min(1)
    .optional()
    .describe("Match title or summary text. Omit for the whole catalog."),
});

export const ChallengeLeaderboardInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(25).optional(),
});

export const ChallengeReadResultSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

/** Discord ids of everyone registered in the servers in scope. */
async function ownersInScope(
  db: ExtendedPrismaClient,
  guildIds: readonly string[],
): Promise<Set<string>> {
  const players = await db.player.findMany({
    where: { serverId: { in: [...guildIds] }, discordId: { not: null } },
    select: { discordId: true },
  });
  return new Set(
    players.flatMap((player) =>
      player.discordId === null ? [] : [player.discordId],
    ),
  );
}

export function createChallengeReadTools(options: {
  readonly db: ExtendedPrismaClient;
  readonly requesterId: DiscordAccountId;
  readonly guildIds: readonly string[];
  readonly track: ToolTracker;
}) {
  return {
    list_my_challenge_runs: tool({
      description:
        "List the requester's own challenge runs — active, completed, archived and failed — with progress toward each active one. Use for 'my challenges', 'how close am I', 'what have I completed'.",
      inputSchema: z.strictObject({}),
      outputSchema: ChallengeReadResultSchema,
      execute: () =>
        options.track("list_my_challenge_runs", async () => {
          const runs = await getChallengeRunHistory(
            options.db,
            options.requesterId,
          );
          const withProgress = await Promise.all(
            runs.map(async (run) => {
              if (run.status !== "active") return { ...run, progress: null };
              const detail = await getChallengeRun(options.db, run.id);
              return {
                ...run,
                progress:
                  detail.currentSnapshot === null
                    ? null
                    : progressSummary(detail.currentSnapshot.progress),
              };
            }),
          );
          return {
            kind: "challenge_runs",
            message:
              withProgress.length === 0
                ? "This user has not started any challenges."
                : "These are the user's own challenge runs.",
            data: withProgress,
          };
        }),
    }),
    list_challenge_catalog: tool({
      description:
        "List the challenges available to start, with how many players in the servers in scope have started and completed each. Use for 'what challenges are available', 'hardest challenge', 'lowest completion rate'.",
      inputSchema: ChallengeCatalogInputSchema,
      outputSchema: ChallengeReadResultSchema,
      execute: (input) =>
        options.track("list_challenge_catalog", async () => {
          const [catalog, owners] = await Promise.all([
            searchChallengeCatalog(options.db, input.search),
            ownersInScope(options.db, options.guildIds),
          ]);
          const runs = await options.db.challengeRun.groupBy({
            by: ["templateId", "runState"],
            where: {
              templateId: { in: catalog.map((entry) => entry.templateId) },
              ownerDiscordId: { in: [...owners] },
            },
            _count: { _all: true },
          });
          const data = catalog.map((entry) => {
            const rows = runs.filter(
              (row) => row.templateId === entry.templateId,
            );
            const started = rows.reduce((sum, row) => sum + row._count._all, 0);
            const completed = rows
              .filter(
                (row) =>
                  ChallengeRunStatusSchema.parse(row.runState) === "completed",
              )
              .reduce((sum, row) => sum + row._count._all, 0);
            return {
              templateId: entry.templateId,
              title: entry.contract.title,
              summary: entry.contract.summary,
              startedInScope: started,
              completedInScope: completed,
            };
          });
          return {
            kind: "challenge_catalog",
            message:
              "Counts cover players registered in the servers in scope. A challenge nobody here has started has no completion rate.",
            data,
          };
        }),
    }),
    challenge_leaderboard: tool({
      description:
        "Rank players in the servers in scope by challenges completed. Use for 'who has completed the most challenges' and completion leaderboards.",
      inputSchema: ChallengeLeaderboardInputSchema,
      outputSchema: ChallengeReadResultSchema,
      execute: (input) =>
        options.track("challenge_leaderboard", async () => {
          const owners = await ownersInScope(options.db, options.guildIds);
          const counts = await options.db.challengeRun.groupBy({
            by: ["ownerDiscordId"],
            where: {
              ownerDiscordId: { in: [...owners] },
              runState: "completed",
            },
            _count: { _all: true },
            orderBy: { _count: { ownerDiscordId: "desc" } },
            take: input.limit ?? 10,
          });
          const players = await options.db.player.findMany({
            where: {
              serverId: { in: [...options.guildIds] },
              discordId: { in: counts.map((row) => row.ownerDiscordId) },
            },
            select: { discordId: true, alias: true },
          });
          const alias = new Map<string, string>(
            players.flatMap((player) =>
              player.discordId === null
                ? []
                : [[player.discordId, player.alias] as const],
            ),
          );
          return {
            kind: "challenge_leaderboard",
            message:
              counts.length === 0
                ? "No one in the servers in scope has completed a challenge yet."
                : "Completed challenges per player, most first.",
            data: counts.map((row) => ({
              player: alias.get(row.ownerDiscordId) ?? "unknown player",
              completed: row._count._all,
            })),
          };
        }),
    }),
  };
}
