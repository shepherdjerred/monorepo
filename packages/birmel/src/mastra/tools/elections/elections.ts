import { createTool } from "../../../voltagent/tools/create-tool.js";
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

export const getElectionHistoryTool = createTool({
	id: "get-election-history",
	description:
		"Get the election history for a Discord guild, showing past elections, winners, and vote counts.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		limit: z
			.number()
			.min(1)
			.max(100)
			.optional()
			.default(10)
			.describe("Maximum number of elections to return"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				elections: z.array(
					z.object({
						id: z.number(),
						pollType: z.enum(["election", "runoff"]),
						status: z.string(),
						winner: z.string().optional(),
						candidates: z.array(z.string()),
						voteCounts: z.record(z.string(), z.number()).optional(),
						scheduledStart: z.string(),
						scheduledEnd: z.string(),
						actualEnd: z.string().optional(),
					}),
				),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-election-history", undefined, async () => {
			logger.debug("Fetching election history", { guildId: input.guildId });

			try {
				const elections = await prisma.electionPoll.findMany({
					where: { guildId: input.guildId },
					orderBy: { scheduledStart: "desc" },
					take: input.limit,
				});

				const electionData = elections.map((e) => ({
					id: e.id,
					pollType: e.pollType as "election" | "runoff",
					status: e.status,
					winner: e.winner ?? undefined,
					candidates: JSON.parse(e.candidates) as string[],
					voteCounts: e.voteCounts
						? (JSON.parse(e.voteCounts) as Record<string, number>)
						: undefined,
					scheduledStart: e.scheduledStart.toISOString(),
					scheduledEnd: e.scheduledEnd.toISOString(),
					actualEnd: e.actualEnd?.toISOString(),
				}));

				logger.info("Election history fetched", {
					guildId: input.guildId,
					count: electionData.length,
				});

				return {
					success: true,
					message: `Found ${electionData.length.toString()} elections`,
					data: {
						elections: electionData,
					},
				};
			} catch (error) {
				logger.error("Failed to fetch election history", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-election-history",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to fetch history: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getCurrentElectionTool = createTool({
	id: "get-current-election",
	description:
		"Get information about the currently active or scheduled election for a Discord guild.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				id: z.number(),
				pollType: z.enum(["election", "runoff"]),
				status: z.string(),
				candidates: z.array(z.string()),
				scheduledStart: z.string(),
				scheduledEnd: z.string(),
				messageId: z.string().optional(),
				channelId: z.string(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-current-election", undefined, async () => {
			logger.debug("Fetching current election", { guildId: input.guildId });

			try {
				const election = await prisma.electionPoll.findFirst({
					where: {
						guildId: input.guildId,
						status: { in: ["scheduled", "active"] },
					},
					orderBy: { scheduledStart: "desc" },
				});

				if (!election) {
					return {
						success: false,
						message: `No active or scheduled election for guild ${input.guildId}`,
					};
				}

				logger.info("Current election fetched", {
					guildId: input.guildId,
					electionId: election.id,
					status: election.status,
				});

				return {
					success: true,
					message: `Found ${election.status} ${election.pollType}`,
					data: {
						id: election.id,
						pollType: election.pollType as "election" | "runoff",
						status: election.status,
						candidates: JSON.parse(election.candidates) as string[],
						scheduledStart: election.scheduledStart.toISOString(),
						scheduledEnd: election.scheduledEnd.toISOString(),
						messageId: election.messageId ?? undefined,
						channelId: election.channelId,
					},
				};
			} catch (error) {
				logger.error("Failed to fetch current election", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-current-election",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to fetch election: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getElectionStatsTool = createTool({
	id: "get-election-stats",
	description:
		"Get election statistics for a Discord guild, including total elections, win rates by candidate, and average voter turnout.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				totalElections: z.number().describe("Total number of completed elections"),
				totalRunoffs: z.number().describe("Total number of runoff elections"),
				winsByCandidate: z
					.record(z.string(), z.number())
					.describe("Number of wins per candidate"),
				totalVotesCast: z.number().describe("Total votes cast across all elections"),
				averageVotesPerElection: z
					.number()
					.describe("Average number of votes per election"),
				mostRecentWinner: z.string().optional().describe("The most recent election winner"),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-election-stats", undefined, async () => {
			logger.debug("Fetching election stats", { guildId: input.guildId });

			try {
				const elections = await prisma.electionPoll.findMany({
					where: {
						guildId: input.guildId,
						status: "completed",
					},
					orderBy: { actualEnd: "desc" },
				});

				const totalElections = elections.filter((e) => e.pollType === "election").length;
				const totalRunoffs = elections.filter((e) => e.pollType === "runoff").length;

				const winsByCandidate: Record<string, number> = {};
				let totalVotesCast = 0;

				for (const election of elections) {
					if (election.winner) {
						winsByCandidate[election.winner] =
							(winsByCandidate[election.winner] ?? 0) + 1;
					}
					if (election.voteCounts) {
						const votes = JSON.parse(election.voteCounts) as Record<string, number>;
						for (const count of Object.values(votes)) {
							totalVotesCast += count;
						}
					}
				}

				const completedCount = elections.length;
				const averageVotesPerElection =
					completedCount > 0 ? Math.round(totalVotesCast / completedCount) : 0;
				const mostRecentWinner = elections[0]?.winner ?? undefined;

				logger.info("Election stats fetched", {
					guildId: input.guildId,
					totalElections,
					totalRunoffs,
				});

				return {
					success: true,
					message: `Found ${completedCount.toString()} completed elections`,
					data: {
						totalElections,
						totalRunoffs,
						winsByCandidate,
						totalVotesCast,
						averageVotesPerElection,
						mostRecentWinner,
					},
				};
			} catch (error) {
				logger.error("Failed to fetch election stats", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-election-stats",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to fetch stats: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getCandidatesTool = createTool({
	id: "get-candidates",
	description:
		"Get the list of all available election candidates (personas) that can run in elections.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				candidates: z.array(z.string()).describe("List of candidate names"),
				count: z.number().describe("Total number of candidates"),
			})
			.optional(),
	}),
	execute: async () => {
		return withToolSpan("get-candidates", undefined, async () => {
			logger.debug("Fetching available candidates");

			try {
				const candidates = getAllCandidates();
				await Promise.resolve();

				logger.info("Candidates fetched", { count: candidates.length });

				return {
					success: true,
					message: `Found ${candidates.length.toString()} available candidates`,
					data: {
						candidates,
						count: candidates.length,
					},
				};
			} catch (error) {
				logger.error("Failed to fetch candidates", error);
				captureException(error as Error, {
					operation: "tool.get-candidates",
				});
				return {
					success: false,
					message: `Failed to fetch candidates: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getElectionByIdTool = createTool({
	id: "get-election-by-id",
	description: "Get detailed information about a specific election by its ID.",
	inputSchema: z.object({
		electionId: z.number().describe("The election ID to look up"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				id: z.number(),
				guildId: z.string(),
				channelId: z.string(),
				messageId: z.string().optional(),
				pollType: z.enum(["election", "runoff"]),
				status: z.string(),
				candidates: z.array(z.string()),
				winner: z.string().optional(),
				voteCounts: z.record(z.string(), z.number()).optional(),
				scheduledStart: z.string(),
				scheduledEnd: z.string(),
				actualStart: z.string().optional(),
				actualEnd: z.string().optional(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-election-by-id", undefined, async () => {
			logger.debug("Fetching election by ID", { electionId: input.electionId });

			try {
				const election = await prisma.electionPoll.findUnique({
					where: { id: input.electionId },
				});

				if (!election) {
					return {
						success: false,
						message: `Election with ID ${input.electionId.toString()} not found`,
					};
				}

				logger.info("Election fetched by ID", {
					electionId: election.id,
					status: election.status,
				});

				return {
					success: true,
					message: `Found ${election.pollType} (${election.status})`,
					data: {
						id: election.id,
						guildId: election.guildId,
						channelId: election.channelId,
						messageId: election.messageId ?? undefined,
						pollType: election.pollType as "election" | "runoff",
						status: election.status,
						candidates: JSON.parse(election.candidates) as string[],
						winner: election.winner ?? undefined,
						voteCounts: election.voteCounts
							? (JSON.parse(election.voteCounts) as Record<string, number>)
							: undefined,
						scheduledStart: election.scheduledStart.toISOString(),
						scheduledEnd: election.scheduledEnd.toISOString(),
						actualStart: election.actualStart?.toISOString(),
						actualEnd: election.actualEnd?.toISOString(),
					},
				};
			} catch (error) {
				logger.error("Failed to fetch election by ID", error, {
					electionId: input.electionId,
				});
				captureException(error as Error, {
					operation: "tool.get-election-by-id",
					extra: { electionId: input.electionId },
				});
				return {
					success: false,
					message: `Failed to fetch election: ${(error as Error).message}`,
				};
			}
		});
	},
});

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
				averageVotesPerElection: z.number().describe("Average votes per election"),
				lastElectionDate: z.string().optional().describe("Date of last election participated"),
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

						if (!lastElectionDate && election.actualEnd) {
							lastElectionDate = election.actualEnd.toISOString();
						}

						if (election.winner?.toLowerCase() === candidateLower) {
							wins++;
							if (!lastWinDate && election.actualEnd) {
								lastWinDate = election.actualEnd.toISOString();
							}
						}

						if (election.voteCounts) {
							const votes = JSON.parse(election.voteCounts) as Record<string, number>;
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

export const electionTools = [
	manageElectionTool,
	getElectionHistoryTool,
	getCurrentElectionTool,
	getElectionStatsTool,
	getCandidatesTool,
	getElectionByIdTool,
	getCandidateStatsTool,
];
