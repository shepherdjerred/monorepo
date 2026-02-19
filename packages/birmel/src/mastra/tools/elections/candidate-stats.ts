import { getErrorMessage, toError, parseJsonStringArray, parseJsonNumberRecord } from "@shepherdjerred/birmel/utils/errors.ts";
import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { prisma } from "@shepherdjerred/birmel/database/index.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";

const logger = loggers.tools.child("elections");

type ElectionProcessResult = {
  won: boolean;
  votes: number;
  lastElectionDate: string | undefined;
  lastWinDate: string | undefined;
};

function processCandidateElection(
  election: { candidates: string | null; winner: string | null; actualEnd: Date | null; voteCounts: string | null },
  candidateLower: string,
  currentLastElectionDate: string | undefined,
  currentLastWinDate: string | undefined,
): ElectionProcessResult | null {
  if (election.candidates == null) {
    return null;
  }
  const candidates = parseJsonStringArray(election.candidates);
  const candidatesLower = candidates.map((c) => c.toLowerCase());
  if (!candidatesLower.includes(candidateLower)) {
    return null;
  }

  let lastElectionDate = currentLastElectionDate;
  let lastWinDate = currentLastWinDate;

  if ((lastElectionDate == null || lastElectionDate.length === 0) && election.actualEnd != null) {
    lastElectionDate = election.actualEnd.toISOString();
  }

  const won = election.winner?.toLowerCase() === candidateLower;
  if (won && (lastWinDate == null || lastWinDate.length === 0) && election.actualEnd != null) {
    lastWinDate = election.actualEnd.toISOString();
  }

  const votes = getVotesForCandidateFromRecord(election.voteCounts, candidateLower);

  return { won, votes, lastElectionDate, lastWinDate };
}

function getVotesForCandidateFromRecord(
  voteCounts: string | null,
  candidateLower: string,
): number {
  if (voteCounts == null || voteCounts.length === 0) {
    return 0;
  }
  const votes = parseJsonNumberRecord(voteCounts);
  let total = 0;
  for (const [name, count] of Object.entries(votes)) {
    if (name.toLowerCase() === candidateLower) {
      total += count;
    }
  }
  return total;
}

export const getCandidateStatsTool = createTool({
  id: "get-candidate-stats",
  description:
    "Get statistics for a specific candidate, including win rate, elections participated in, and vote history.",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild ID"),
    candidateName: z.string().describe("The candidate name to get stats for"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .object({
        candidateName: z.string(),
        totalElectionsParticipated: z
          .number()
          .describe("Number of elections this candidate was in"),
        wins: z.number().describe("Number of elections won"),
        winRate: z.number().describe("Win rate as a percentage"),
        totalVotesReceived: z
          .number()
          .describe("Total votes received across all elections"),
        averageVotesPerElection: z
          .number()
          .describe("Average votes per election"),
        lastElectionDate: z
          .string()
          .optional()
          .describe("Date of last election participated"),
        lastWinDate: z.string().optional().describe("Date of last win"),
      })
      .optional(),
  }),
  execute: async (input) => {
    return withToolSpan("get-candidate-stats", undefined, async () => {
      logger.debug("Fetching candidate stats", {
        guildId: input.guildId,
        candidateName: input.candidateName,
      });

      try {
        const elections = await prisma.electionPoll.findMany({
          where: {
            guildId: input.guildId,
            status: "completed",
          },
          orderBy: { actualEnd: "desc" },
        });

        const candidateLower = input.candidateName.toLowerCase();
        let totalElectionsParticipated = 0;
        let wins = 0;
        let totalVotesReceived = 0;
        let lastElectionDate: string | undefined;
        let lastWinDate: string | undefined;

        for (const election of elections) {
          const result = processCandidateElection(
            election,
            candidateLower,
            lastElectionDate,
            lastWinDate,
          );
          if (result == null) {
            continue;
          }
          totalElectionsParticipated++;
          wins += result.won ? 1 : 0;
          totalVotesReceived += result.votes;
          lastElectionDate = result.lastElectionDate;
          lastWinDate = result.lastWinDate;
        }

        const winRate =
          totalElectionsParticipated > 0
            ? Math.round((wins / totalElectionsParticipated) * 100)
            : 0;
        const averageVotesPerElection =
          totalElectionsParticipated > 0
            ? Math.round(totalVotesReceived / totalElectionsParticipated)
            : 0;

        logger.info("Candidate stats fetched", {
          guildId: input.guildId,
          candidateName: input.candidateName,
          wins,
          totalElectionsParticipated,
        });

        return {
          success: true,
          message: `Stats for ${input.candidateName}: ${wins.toString()} wins in ${totalElectionsParticipated.toString()} elections`,
          data: {
            candidateName: input.candidateName,
            totalElectionsParticipated,
            wins,
            winRate,
            totalVotesReceived,
            averageVotesPerElection,
            lastElectionDate,
            lastWinDate,
          },
        };
      } catch (error) {
        logger.error("Failed to fetch candidate stats", error, {
          guildId: input.guildId,
          candidateName: input.candidateName,
        });
        captureException(toError(error), {
          operation: "tool.get-candidate-stats",
          extra: { guildId: input.guildId, candidateName: input.candidateName },
        });
        return {
          success: false,
          message: `Failed to fetch stats: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});
