import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { prisma } from "../../../database/index.js";
import { getGuildOwner } from "../../../database/repositories/guild-owner.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";

const logger = loggers.tools.child("elections");

export const getGuildOwnerTool = createTool({
	id: "get-guild-owner",
	description:
		"Get the current server owner (persona) for a Discord guild. The owner determines the bot's personality and nickname.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				currentOwner: z.string().describe("The current owner's persona name"),
				nickname: z.string().describe("The bot's current nickname"),
				lastElectionAt: z
					.string()
					.optional()
					.describe("ISO timestamp of last election"),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-guild-owner", undefined, async () => {
			logger.debug("Fetching guild owner", { guildId: input.guildId });

			try {
				const owner = await getGuildOwner(input.guildId);

				if (!owner) {
					return {
						success: false,
						message: `No owner record found for guild ${input.guildId}`,
					};
				}

				logger.info("Guild owner fetched", {
					guildId: input.guildId,
					owner: owner.currentOwner,
				});

				return {
					success: true,
					message: `Current owner: ${owner.currentOwner} (${owner.nickname})`,
					data: {
						currentOwner: owner.currentOwner,
						nickname: owner.nickname,
						lastElectionAt: owner.lastElectionAt?.toISOString(),
					},
				};
			} catch (error) {
				logger.error("Failed to fetch guild owner", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-guild-owner",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to fetch owner: ${(error as Error).message}`,
				};
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
						voteCounts: z.record(z.number()).optional(),
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

export const electionTools = [
	getGuildOwnerTool,
	getElectionHistoryTool,
	getCurrentElectionTool,
];
