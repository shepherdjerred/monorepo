import { getDiscordClient } from "../../discord/client.js";
import {
	createPoll,
	getPollResults,
	endPoll,
} from "../../discord/polls/helpers.js";
import {
	createElectionPoll,
	updateElectionStatus,
} from "../../database/repositories/elections.js";
import { setGuildOwner } from "../../database/repositories/guild-owner.js";
import {
	selectRandomCandidates,
	createElectionAnswers,
} from "../../elections/candidates.js";
import {
	determineWinner,
	generateNickname,
} from "../../elections/winner.js";
import { updateBotNickname } from "../../elections/bot-nickname.js";
import { updateBotProfile } from "../../elections/bot-profile.js";
import { loggers } from "../../utils/index.js";
import { prisma } from "../../database/index.js";
import { getConfig } from "../../config/index.js";

const logger = loggers.scheduler.child("elections");

function getCurrentTimeInTimezone(timezone: string): { hours: number; minutes: number; dayOfWeek: number } {
	const now = new Date();
	const timeFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const dayFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		weekday: "short",
	});

	const timeParts = timeFormatter.formatToParts(now);
	const hours = Number.parseInt(timeParts.find((p) => p.type === "hour")?.value ?? "0", 10);
	const minutes = Number.parseInt(timeParts.find((p) => p.type === "minute")?.value ?? "0", 10);

	// Get day of week (0=Sunday, 6=Saturday)
	const dayStr = dayFormatter.format(now);
	const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	const dayOfWeek = dayMap[dayStr] ?? 0;

	return { hours, minutes, dayOfWeek };
}

function isElectionStartTime(): boolean {
	const config = getConfig();
	if (!config.elections.enabled) return false;

	const [targetHour, targetMinute] = config.elections.startTime.split(":").map(Number);
	const current = getCurrentTimeInTimezone(config.elections.timezone);

	// Check if it's the configured day of the week (default: Wednesday = 3)
	if (current.dayOfWeek !== config.elections.dayOfWeek) return false;

	// Allow a 5-minute window for the scheduler
	const currentMinutes = current.hours * 60 + current.minutes;
	const targetMinutes = (targetHour ?? 0) * 60 + (targetMinute ?? 0);

	return currentMinutes >= targetMinutes && currentMinutes < targetMinutes + 5;
}

async function hasElectionThisWeek(guildId: string): Promise<boolean> {
	const now = new Date();
	const dayOfWeek = now.getDay(); // 0=Sunday, 6=Saturday

	// Calculate start of the current week (Sunday at 00:00:00)
	const weekStart = new Date(now);
	weekStart.setDate(now.getDate() - dayOfWeek);
	weekStart.setHours(0, 0, 0, 0);

	// Calculate end of the current week (Saturday at 23:59:59)
	const weekEnd = new Date(weekStart);
	weekEnd.setDate(weekStart.getDate() + 6);
	weekEnd.setHours(23, 59, 59, 999);

	const election = await prisma.electionPoll.findFirst({
		where: {
			guildId,
			pollType: "election",
			createdAt: {
				gte: weekStart,
				lte: weekEnd,
			},
		},
	});

	return election !== null;
}

export async function checkAndStartElections(): Promise<void> {
	try {
		// Only run if it's election start time
		if (!isElectionStartTime()) {
			return;
		}

		const config = getConfig();
		const client = getDiscordClient();

		// Get all guilds the bot is in
		const guilds = await client.guilds.fetch();

		for (const [guildId, oauthGuild] of guilds) {
			try {
				// Check if election already exists for this week
				if (await hasElectionThisWeek(guildId)) {
					logger.debug("Election already exists for this week", { guildId });
					continue;
				}

				// Fetch full guild to get system channel
				const fullGuild = await oauthGuild.fetch();

				// Determine channel: config channelId > system channel > skip
				let channelId = config.elections.channelId;
				channelId ??= fullGuild.systemChannelId ?? undefined;

				if (!channelId) {
					logger.warn("No channel available for election", { guildId });
					continue;
				}

				// Verify channel is accessible and text-based
				const channel = await client.channels.fetch(channelId);
				if (!channel?.isTextBased()) {
					logger.warn("Election channel not text-based", { guildId, channelId });
					continue;
				}

				// Select random candidates and create poll
				const candidates = selectRandomCandidates();
				const answers = createElectionAnswers(candidates);

				const now = new Date();
				const endTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

				const result = await createPoll({
					channelId,
					question: "🗳️ Who should be the server owner?",
					answers,
					duration: 2, // 2 hours
					allowMultiselect: false,
				});

				if (!result.success || !result.data) {
					logger.error("Failed to create poll", { guildId, result });
					continue;
				}

				// Create election record
				await createElectionPoll({
					guildId,
					channelId,
					pollType: "election",
					scheduledStart: now,
					scheduledEnd: endTime,
					candidates,
				});

				// Update with message ID and mark as active
				const electionRecord = await prisma.electionPoll.findFirst({
					where: { guildId, messageId: null },
					orderBy: { createdAt: "desc" },
				});

				if (electionRecord) {
					await updateElectionStatus(electionRecord.id, "active", {
						messageId: result.data.messageId,
						actualStart: now,
					});
				}

				logger.info("Weekly election created and started", {
					guildId,
					channelId,
					candidates: candidates.length,
					endTime,
				});
			} catch (error) {
				logger.error("Failed to create election for guild", error, { guildId });
			}
		}
	} catch (error) {
		logger.error("Failed to check and start elections", error);
	}
}

export async function checkAndEndElections(): Promise<void> {
	try {
		const elections = await prisma.electionPoll.findMany({
			where: {
				status: "active",
				scheduledEnd: { lte: new Date() },
				messageId: { not: null },
			},
		});

		for (const election of elections) {
			if (!election.messageId) continue;

			try {
				await endPoll(election.channelId, election.messageId);

				logger.info("Election ended", {
					guildId: election.guildId,
					messageId: election.messageId,
				});
			} catch (error) {
				logger.error("Failed to end election", error, {
					electionId: election.id,
					guildId: election.guildId,
					messageId: election.messageId,
				});
			}
		}
	} catch (error) {
		logger.error("Failed to check and end elections", error);
	}
}

export async function processElectionResults(): Promise<void> {
	try {
		const elections = await prisma.electionPoll.findMany({
			where: {
				status: "active",
				actualEnd: null,
				messageId: { not: null },
			},
		});

		for (const election of elections) {
			if (!election.messageId) continue;

			try {
				// Check if poll is finalized
				const pollResults = await getPollResults(
					election.channelId,
					election.messageId,
				);

				if (!pollResults.success || !pollResults.data?.isFinalized) continue;

				const results = determineWinner(pollResults.data.answers);

				// Handle tie - create runoff
				if (results.isTie) {
					await updateElectionStatus(election.id, "completed", {
						actualEnd: new Date(),
						voteCounts: JSON.stringify(results.voteCounts),
					});

					// Create runoff poll
					const runoffEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
					await createElectionPoll({
						guildId: election.guildId,
						channelId: election.channelId,
						pollType: "runoff",
						scheduledStart: new Date(),
						scheduledEnd: runoffEnd,
						candidates: results.tiedCandidates,
					});

					logger.info("Runoff created", {
						guildId: election.guildId,
						tiedCandidates: results.tiedCandidates,
					});
					continue;
				}

				// Update guild owner
				const winner = results.winner ?? "jerred";
				const nickname = generateNickname(winner);

				await setGuildOwner(election.guildId, winner, nickname);
				await updateBotNickname(election.guildId, nickname);
				await updateBotProfile(winner);

				await updateElectionStatus(election.id, "completed", {
					actualEnd: new Date(),
					winner,
					voteCounts: JSON.stringify(results.voteCounts),
				});

				logger.info("Election completed", {
					guildId: election.guildId,
					winner,
					nickname,
					totalVotes: results.totalVotes,
				});
			} catch (error) {
				logger.error("Failed to process election results", error, {
					electionId: election.id,
					guildId: election.guildId,
				});
			}
		}
	} catch (error) {
		logger.error("Failed to process election results", error);
	}
}
