import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { prisma } from "../../../database/index.js";
import { getGuildOwner } from "../../../database/repositories/guild-owner.js";
import { getAllCandidates } from "../../../elections/candidates.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";

const logger = loggers.tools.child("elections");

export const manageElectionTool = createTool({
  id: "manage-election",
  description: "Manage elections: get owner, get history, get current, get stats, get candidates, get by ID, or get candidate stats",
  inputSchema: z.object({
    action: z.enum(["get-owner", "get-history", "get-current", "get-stats", "get-candidates", "get-by-id", "get-candidate-stats"]).describe("The action to perform"),
    guildId: z.string().optional().describe("Guild ID (for most actions)"),
    limit: z.number().min(1).max(100).optional().describe("Max results (for get-history)"),
    electionId: z.number().optional().describe("Election ID (for get-by-id)"),
    candidateName: z.string().optional().describe("Candidate name (for get-candidate-stats)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-election", undefined, async () => {
      try {
        switch (ctx.action) {
          case "get-owner": {
            if (!ctx.guildId) return { success: false, message: "guildId is required" };
            const owner = await getGuildOwner(ctx.guildId);
            if (!owner) return { success: false, message: `No owner record found for guild ${ctx.guildId}` };
            return {
              success: true,
              message: `Current owner: ${owner.currentOwner} (${owner.nickname})`,
              data: {
                currentOwner: owner.currentOwner,
                nickname: owner.nickname,
                lastElectionAt: owner.lastElectionAt?.toISOString(),
              },
            };
          }

          case "get-history": {
            if (!ctx.guildId) return { success: false, message: "guildId is required" };
            const elections = await prisma.electionPoll.findMany({
              where: { guildId: ctx.guildId },
              orderBy: { scheduledStart: "desc" },
              take: ctx.limit ?? 10,
            });
            const data = elections.map((e) => ({
              id: e.id,
              pollType: e.pollType,
              status: e.status,
              winner: e.winner ?? undefined,
              candidates: JSON.parse(e.candidates) as string[],
              voteCounts: e.voteCounts ? (JSON.parse(e.voteCounts) as Record<string, number>) : undefined,
              scheduledStart: e.scheduledStart.toISOString(),
              scheduledEnd: e.scheduledEnd.toISOString(),
              actualEnd: e.actualEnd?.toISOString(),
            }));
            return { success: true, message: `Found ${data.length.toString()} elections`, data: { elections: data } };
          }

          case "get-current": {
            if (!ctx.guildId) return { success: false, message: "guildId is required" };
            const election = await prisma.electionPoll.findFirst({
              where: { guildId: ctx.guildId, status: { in: ["scheduled", "active"] } },
              orderBy: { scheduledStart: "desc" },
            });
            if (!election) return { success: false, message: "No active or scheduled election" };
            return {
              success: true,
              message: `Found ${election.status} ${election.pollType}`,
              data: {
                id: election.id,
                pollType: election.pollType,
                status: election.status,
                candidates: JSON.parse(election.candidates) as string[],
                scheduledStart: election.scheduledStart.toISOString(),
                scheduledEnd: election.scheduledEnd.toISOString(),
                messageId: election.messageId ?? undefined,
                channelId: election.channelId,
              },
            };
          }

          case "get-stats": {
            if (!ctx.guildId) return { success: false, message: "guildId is required" };
            const elections = await prisma.electionPoll.findMany({
              where: { guildId: ctx.guildId, status: "completed" },
              orderBy: { actualEnd: "desc" },
            });
            const totalElections = elections.filter((e) => e.pollType === "election").length;
            const totalRunoffs = elections.filter((e) => e.pollType === "runoff").length;
            const winsByCandidate: Record<string, number> = {};
            let totalVotesCast = 0;
            for (const e of elections) {
              if (e.winner) winsByCandidate[e.winner] = (winsByCandidate[e.winner] ?? 0) + 1;
              if (e.voteCounts) {
                const votes = JSON.parse(e.voteCounts) as Record<string, number>;
                for (const count of Object.values(votes)) totalVotesCast += count;
              }
            }
            return {
              success: true,
              message: `Found ${elections.length.toString()} completed elections`,
              data: {
                totalElections,
                totalRunoffs,
                winsByCandidate,
                totalVotesCast,
                averageVotesPerElection: elections.length > 0 ? Math.round(totalVotesCast / elections.length) : 0,
                mostRecentWinner: elections[0]?.winner ?? undefined,
              },
            };
          }

          case "get-candidates": {
            const candidates = getAllCandidates();
            return { success: true, message: `Found ${candidates.length.toString()} candidates`, data: { candidates, count: candidates.length } };
          }

          case "get-by-id": {
            if (!ctx.electionId) return { success: false, message: "electionId is required" };
            const election = await prisma.electionPoll.findUnique({ where: { id: ctx.electionId } });
            if (!election) return { success: false, message: `Election ${ctx.electionId.toString()} not found` };
            return {
              success: true,
              message: `Found ${election.pollType} (${election.status})`,
              data: {
                id: election.id,
                guildId: election.guildId,
                channelId: election.channelId,
                messageId: election.messageId ?? undefined,
                pollType: election.pollType,
                status: election.status,
                candidates: JSON.parse(election.candidates) as string[],
                winner: election.winner ?? undefined,
                voteCounts: election.voteCounts ? (JSON.parse(election.voteCounts) as Record<string, number>) : undefined,
                scheduledStart: election.scheduledStart.toISOString(),
                scheduledEnd: election.scheduledEnd.toISOString(),
                actualStart: election.actualStart?.toISOString(),
                actualEnd: election.actualEnd?.toISOString(),
              },
            };
          }

          case "get-candidate-stats": {
            if (!ctx.guildId || !ctx.candidateName) return { success: false, message: "guildId and candidateName are required" };
            const elections = await prisma.electionPoll.findMany({
              where: { guildId: ctx.guildId, status: "completed" },
              orderBy: { actualEnd: "desc" },
            });
            const candidateLower = ctx.candidateName.toLowerCase();
            let totalElectionsParticipated = 0, wins = 0, totalVotesReceived = 0;
            let lastElectionDate: string | undefined, lastWinDate: string | undefined;
            for (const e of elections) {
              const candidates = (JSON.parse(e.candidates) as string[]).map((c) => c.toLowerCase());
              if (candidates.includes(candidateLower)) {
                totalElectionsParticipated++;
                if (!lastElectionDate && e.actualEnd) lastElectionDate = e.actualEnd.toISOString();
                if (e.winner?.toLowerCase() === candidateLower) {
                  wins++;
                  if (!lastWinDate && e.actualEnd) lastWinDate = e.actualEnd.toISOString();
                }
                if (e.voteCounts) {
                  const votes = JSON.parse(e.voteCounts) as Record<string, number>;
                  for (const [name, count] of Object.entries(votes)) {
                    if (name.toLowerCase() === candidateLower) totalVotesReceived += count;
                  }
                }
              }
            }
            return {
              success: true,
              message: `Stats for ${ctx.candidateName}: ${wins.toString()} wins in ${totalElectionsParticipated.toString()} elections`,
              data: {
                candidateName: ctx.candidateName,
                totalElectionsParticipated,
                wins,
                winRate: totalElectionsParticipated > 0 ? Math.round((wins / totalElectionsParticipated) * 100) : 0,
                totalVotesReceived,
                averageVotesPerElection: totalElectionsParticipated > 0 ? Math.round(totalVotesReceived / totalElectionsParticipated) : 0,
                lastElectionDate,
                lastWinDate,
              },
            };
          }
        }
      } catch (error) {
        logger.error("Failed to manage election", error);
        captureException(error as Error, { operation: "tool.manage-election" });
        return { success: false, message: `Failed: ${(error as Error).message}` };
      }
    });
  },
});

export const electionTools = [manageElectionTool];
