import { tool } from "ai";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  MatchIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import {
  loadMatchMvpTallyForGuild,
  MatchMvpGuildTallySchema,
  MatchMvpTallyNomineeSchema,
  type MatchMvpGuildTally,
  type MatchMvpTallyNominee,
} from "#src/mvp-votes/query/tally.ts";
import {
  loadMvpVoteLeaderboard,
  MvpVoteLeaderboardResultSchema,
  MvpVoteQueueTypeSchema,
} from "#src/mvp-votes/query/leaderboard.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

export type MvpVotesExploreCapability = {
  serverId: DiscordGuildId;
};

/**
 * Whether — and for which guild — this turn may read community MVP votes.
 *
 * Unlike Bryan Bucks, MVP votes are not production-hard-disabled and can be
 * on for more than one of a viewer's guilds. Flipt is authoritative, so every
 * guild in scope is evaluated with `isPolicyEnabled`. Zero enabled guilds, or
 * more than one, hide the tools: aborting the turn would take down all of
 * Explore for anyone shared by two enabled servers.
 */
export async function resolveMvpVotesCapability(
  guildIds: readonly string[],
): Promise<MvpVotesExploreCapability | null> {
  const enabled: DiscordGuildId[] = [];
  for (const guildId of guildIds) {
    const serverId = DiscordGuildIdSchema.parse(guildId);
    if (await isPolicyEnabled("mvp_votes_enabled", { server: serverId })) {
      enabled.push(serverId);
    }
  }
  const serverId = enabled[0];
  return serverId === undefined || enabled.length !== 1 ? null : { serverId };
}

const LeaderboardToolInputSchema = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  queueType: MvpVoteQueueTypeSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const MatchTallyToolInputSchema = z.strictObject({
  matchId: MatchIdSchema,
});

const MatchMvpExploreNomineeSchema = MatchMvpTallyNomineeSchema.omit({
  reasons: true,
});

const MatchMvpExploreGuildTallySchema = z.strictObject({
  guildId: MatchMvpGuildTallySchema.shape.guildId,
  guildName: MatchMvpGuildTallySchema.shape.guildName,
  blue: z.array(MatchMvpExploreNomineeSchema),
  red: z.array(MatchMvpExploreNomineeSchema),
});

const MatchTallyToolResultSchema = z.strictObject({
  found: z.boolean(),
  message: z.string(),
  tally: MatchMvpExploreGuildTallySchema.nullable(),
});

function nomineesWithoutReasons(
  nominees: readonly MatchMvpTallyNominee[],
): z.infer<typeof MatchMvpExploreNomineeSchema>[] {
  return nominees.map((nominee) => ({
    puuid: nominee.puuid,
    displayName: nominee.displayName,
    championName: nominee.championName,
    voteCount: nominee.voteCount,
  }));
}

/** Drop voter justifications before they enter another member's model context. */
export function toExploreMatchTally(
  tally: MatchMvpGuildTally,
): z.infer<typeof MatchMvpExploreGuildTallySchema> {
  return {
    guildId: tally.guildId,
    guildName: tally.guildName,
    blue: nomineesWithoutReasons(tally.blue),
    red: nomineesWithoutReasons(tally.red),
  };
}

export type MvpVotesExploreToolsInput = {
  capability: MvpVotesExploreCapability;
  track: ToolTracker;
};

export function createMvpVotesToolExecutors(input: MvpVotesExploreToolsInput) {
  return {
    queryLeaderboard: (inputData: unknown) =>
      input.track("query_mvp_vote_leaderboard", async () => {
        const parsed = LeaderboardToolInputSchema.parse(inputData);
        return await loadMvpVoteLeaderboard({
          serverId: input.capability.serverId,
          from: parsed.from,
          to: parsed.to,
          ...(parsed.queueType === undefined
            ? {}
            : { queueType: parsed.queueType }),
          ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
        });
      }),
    queryMatchTally: (inputData: unknown) =>
      input.track("query_mvp_match_tally", async () => {
        const parsed = MatchTallyToolInputSchema.parse(inputData);
        const tally = await loadMatchMvpTallyForGuild({
          matchId: parsed.matchId,
          guild: {
            id: input.capability.serverId,
            name: "this server",
          },
        });
        if (tally === null) {
          return {
            found: false,
            message:
              "No community MVP votes are recorded for this match in this server.",
            tally: null,
          };
        }
        return {
          found: true,
          message: "Community MVP votes for this match in this server.",
          tally: toExploreMatchTally(tally),
        };
      }),
  };
}

export function createMvpVotesExploreTools(input: MvpVotesExploreToolsInput) {
  const executors = createMvpVotesToolExecutors(input);
  return {
    query_mvp_vote_leaderboard: tool({
      description:
        "Rank who received the most community Discord MVP votes in this server over an explicit UTC date range of match start times. Optional queueType is flex. Load the mvp-votes skill first if you have not this turn.",
      inputSchema: LeaderboardToolInputSchema,
      outputSchema: MvpVoteLeaderboardResultSchema,
      execute: (inputData) => executors.queryLeaderboard(inputData),
    }),
    query_mvp_match_tally: tool({
      description:
        "Read the community Discord MVP vote tally for one matchId in this server. Load the mvp-votes skill first if you have not this turn.",
      inputSchema: MatchTallyToolInputSchema,
      outputSchema: MatchTallyToolResultSchema,
      execute: (inputData) => executors.queryMatchTally(inputData),
    }),
  };
}
