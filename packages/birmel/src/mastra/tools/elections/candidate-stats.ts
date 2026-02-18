import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.js";
import { z } from "zod";
import { prisma } from "@shepherdjerred/birmel/database/index.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "@shepherdjerred/birmel/observability/index.js";

const logger = loggers.tools.child("elections");

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
          const candidates = JSON.parse(election.candidates) as string[];
          const candidatesLower = candidates.map((c) => c.toLowerCase());

          if (candidatesLower.includes(candidateLower)) {
            totalElectionsParticipated++;

            if (
              (lastElectionDate == null || lastElectionDate.length === 0) &&
              election.actualEnd != null
            ) {
              lastElectionDate = election.actualEnd.toISOString();
            }

            if (election.winner?.toLowerCase() === candidateLower) {
              wins++;
              if (
                (lastWinDate == null || lastWinDate.length === 0) &&
                election.actualEnd != null
              ) {
                lastWinDate = election.actualEnd.toISOString();
              }
            }

            if (election.voteCounts != null && election.voteCounts.length > 0) {
              const votes = JSON.parse(election.voteCounts) as Record<
                string,
                number
              >;
              for (const [name, count] of Object.entries(votes)) {
                if (name.toLowerCase() === candidateLower) {
                  totalVotesReceived += count;
                }
              }
            }
          }
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
        captureException(error as Error, {
          operation: "tool.get-candidate-stats",
          extra: { guildId: input.guildId, candidateName: input.candidateName },
        });
        return {
          success: false,
          message: `Failed to fetch stats: ${(error as Error).message}`,
        };
      }
    });
  },
});
