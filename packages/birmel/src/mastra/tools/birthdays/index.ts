import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
	createBirthday,
	getBirthday,
	updateBirthday,
	deleteBirthday,
	getBirthdaysToday,
	getUpcomingBirthdays,
	getBirthdaysByMonth,
} from "../../../database/repositories/birthdays.js";
import { loggers } from "../../../utils/logger.js";
import { captureException, withToolSpan } from "../../../observability/index.js";

const logger = loggers.tools.child("birthdays");

export const setBirthdayTool = createTool({
	id: "set-birthday",
	description:
		"Set or register a user's birthday in the server. Use this when someone wants to add their birthday or when you're helping them set it up.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		userId: z.string().describe("The Discord user ID whose birthday to set"),
		birthMonth: z
			.number()
			.min(1)
			.max(12)
			.describe("The birth month (1-12)"),
		birthDay: z
			.number()
			.min(1)
			.max(31)
			.describe("The birth day (1-31)"),
		birthYear: z
			.number()
			.optional()
			.describe("The birth year (optional, used for age calculation)"),
		timezone: z
			.string()
			.optional()
			.default("UTC")
			.describe("The user's timezone (e.g., 'America/New_York')"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				userId: z.string(),
				birthMonth: z.number(),
				birthDay: z.number(),
				birthYear: z.number().optional(),
				timezone: z.string(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("set-birthday", undefined, async () => {
			logger.debug("Setting birthday", {
				guildId: input.guildId,
				userId: input.userId,
			});

			try {
				const birthday = await createBirthday({
					userId: input.userId,
					guildId: input.guildId,
					birthMonth: input.birthMonth,
					birthDay: input.birthDay,
					...(input.birthYear !== undefined && { birthYear: input.birthYear }),
					...(input.timezone !== undefined && { timezone: input.timezone }),
				});

				logger.info("Birthday set", {
					guildId: input.guildId,
					userId: input.userId,
					date: `${input.birthMonth.toString()}/${input.birthDay.toString()}`,
				});

				return {
					success: true,
					message: `Birthday set to ${input.birthMonth.toString()}/${input.birthDay.toString()}${input.birthYear ? `/${input.birthYear.toString()}` : ""}`,
					data: {
						userId: birthday.userId,
						birthMonth: birthday.birthMonth,
						birthDay: birthday.birthDay,
						birthYear: birthday.birthYear ?? undefined,
						timezone: birthday.timezone,
					},
				};
			} catch (error) {
				logger.error("Failed to set birthday", error, {
					guildId: input.guildId,
					userId: input.userId,
				});
				captureException(error as Error, {
					operation: "tool.set-birthday",
					extra: { guildId: input.guildId, userId: input.userId },
				});
				return {
					success: false,
					message: `Failed to set birthday: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getBirthdayTool = createTool({
	id: "get-birthday",
	description:
		"Get a specific user's birthday. Use this to check when someone's birthday is.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		userId: z.string().describe("The Discord user ID whose birthday to get"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				userId: z.string(),
				birthMonth: z.number(),
				birthDay: z.number(),
				birthYear: z.number().optional(),
				timezone: z.string(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-birthday", undefined, async () => {
			logger.debug("Getting birthday", {
				guildId: input.guildId,
				userId: input.userId,
			});

			try {
				const birthday = await getBirthday(input.userId, input.guildId);

				if (!birthday) {
					return {
						success: false,
						message: "No birthday found for this user",
					};
				}

				logger.info("Birthday retrieved", {
					guildId: input.guildId,
					userId: input.userId,
				});

				return {
					success: true,
					message: `Birthday is ${birthday.birthMonth.toString()}/${birthday.birthDay.toString()}${birthday.birthYear ? `/${birthday.birthYear.toString()}` : ""}`,
					data: {
						userId: birthday.userId,
						birthMonth: birthday.birthMonth,
						birthDay: birthday.birthDay,
						birthYear: birthday.birthYear ?? undefined,
						timezone: birthday.timezone,
					},
				};
			} catch (error) {
				logger.error("Failed to get birthday", error, {
					guildId: input.guildId,
					userId: input.userId,
				});
				captureException(error as Error, {
					operation: "tool.get-birthday",
					extra: { guildId: input.guildId, userId: input.userId },
				});
				return {
					success: false,
					message: `Failed to get birthday: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const updateBirthdayTool = createTool({
	id: "update-birthday",
	description:
		"Update an existing birthday for a user. Use this when someone wants to change their birthday information.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		userId: z.string().describe("The Discord user ID whose birthday to update"),
		birthMonth: z
			.number()
			.min(1)
			.max(12)
			.optional()
			.describe("The new birth month (1-12)"),
		birthDay: z
			.number()
			.min(1)
			.max(31)
			.optional()
			.describe("The new birth day (1-31)"),
		birthYear: z
			.number()
			.optional()
			.describe("The new birth year"),
		timezone: z
			.string()
			.optional()
			.describe("The new timezone"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				userId: z.string(),
				birthMonth: z.number(),
				birthDay: z.number(),
				birthYear: z.number().optional(),
				timezone: z.string(),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("update-birthday", undefined, async () => {
			logger.debug("Updating birthday", {
				guildId: input.guildId,
				userId: input.userId,
			});

			try {
				const birthday = await updateBirthday(input.userId, input.guildId, {
					...(input.birthMonth !== undefined && { birthMonth: input.birthMonth }),
					...(input.birthDay !== undefined && { birthDay: input.birthDay }),
					...(input.birthYear !== undefined && { birthYear: input.birthYear }),
					...(input.timezone !== undefined && { timezone: input.timezone }),
				});

				logger.info("Birthday updated", {
					guildId: input.guildId,
					userId: input.userId,
				});

				return {
					success: true,
					message: `Birthday updated to ${birthday.birthMonth.toString()}/${birthday.birthDay.toString()}${birthday.birthYear ? `/${birthday.birthYear.toString()}` : ""}`,
					data: {
						userId: birthday.userId,
						birthMonth: birthday.birthMonth,
						birthDay: birthday.birthDay,
						birthYear: birthday.birthYear ?? undefined,
						timezone: birthday.timezone,
					},
				};
			} catch (error) {
				logger.error("Failed to update birthday", error, {
					guildId: input.guildId,
					userId: input.userId,
				});
				captureException(error as Error, {
					operation: "tool.update-birthday",
					extra: { guildId: input.guildId, userId: input.userId },
				});
				return {
					success: false,
					message: `Failed to update birthday: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const deleteBirthdayTool = createTool({
	id: "delete-birthday",
	description:
		"Delete a user's birthday from the server. Use this when someone wants to remove their birthday.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		userId: z.string().describe("The Discord user ID whose birthday to delete"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
	}),
	execute: async (input) => {
		return withToolSpan("delete-birthday", undefined, async () => {
			logger.debug("Deleting birthday", {
				guildId: input.guildId,
				userId: input.userId,
			});

			try {
				const deleted = await deleteBirthday(input.userId, input.guildId);

				if (!deleted) {
					return {
						success: false,
						message: "No birthday found for this user",
					};
				}

				logger.info("Birthday deleted", {
					guildId: input.guildId,
					userId: input.userId,
				});

				return {
					success: true,
					message: "Birthday deleted successfully",
				};
			} catch (error) {
				logger.error("Failed to delete birthday", error, {
					guildId: input.guildId,
					userId: input.userId,
				});
				captureException(error as Error, {
					operation: "tool.delete-birthday",
					extra: { guildId: input.guildId, userId: input.userId },
				});
				return {
					success: false,
					message: `Failed to delete birthday: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getBirthdaysTodayTool = createTool({
	id: "get-birthdays-today",
	description:
		"Get all birthdays happening today in the server. Use this to check who has a birthday today.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				birthdays: z.array(
					z.object({
						userId: z.string(),
						birthMonth: z.number(),
						birthDay: z.number(),
						birthYear: z.number().optional(),
					}),
				),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-birthdays-today", undefined, async () => {
			logger.debug("Getting today's birthdays", { guildId: input.guildId });

			try {
				const birthdays = await getBirthdaysToday(input.guildId);

				logger.info("Today's birthdays retrieved", {
					guildId: input.guildId,
					count: birthdays.length,
				});

				const birthdayData = birthdays.map((b) => ({
					userId: b.userId,
					birthMonth: b.birthMonth,
					birthDay: b.birthDay,
					birthYear: b.birthYear ?? undefined,
				}));

				return {
					success: true,
					message:
						birthdays.length > 0
							? `Found ${birthdays.length.toString()} birthday(s) today`
							: "No birthdays today",
					data: {
						birthdays: birthdayData,
					},
				};
			} catch (error) {
				logger.error("Failed to get today's birthdays", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-birthdays-today",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to get today's birthdays: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getUpcomingBirthdaysTool = createTool({
	id: "get-upcoming-birthdays",
	description:
		"Get upcoming birthdays in the server within the next N days. Use this to see who has birthdays coming up soon.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		daysAhead: z
			.number()
			.min(1)
			.max(365)
			.optional()
			.default(7)
			.describe("Number of days to look ahead (default: 7)"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				birthdays: z.array(
					z.object({
						userId: z.string(),
						birthMonth: z.number(),
						birthDay: z.number(),
						birthYear: z.number().optional(),
						daysUntil: z.number(),
					}),
				),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-upcoming-birthdays", undefined, async () => {
			logger.debug("Getting upcoming birthdays", {
				guildId: input.guildId,
				daysAhead: input.daysAhead,
			});

			try {
				const birthdays = await getUpcomingBirthdays(
					input.guildId,
					input.daysAhead,
				);

				logger.info("Upcoming birthdays retrieved", {
					guildId: input.guildId,
					count: birthdays.length,
				});

				return {
					success: true,
					message:
						birthdays.length > 0
							? `Found ${birthdays.length.toString()} upcoming birthday(s)`
							: `No birthdays in the next ${input.daysAhead.toString()} days`,
					data: {
						birthdays,
					},
				};
			} catch (error) {
				logger.error("Failed to get upcoming birthdays", error, {
					guildId: input.guildId,
				});
				captureException(error as Error, {
					operation: "tool.get-upcoming-birthdays",
					extra: { guildId: input.guildId },
				});
				return {
					success: false,
					message: `Failed to get upcoming birthdays: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const getBirthdaysByMonthTool = createTool({
	id: "get-birthdays-by-month",
	description:
		"Get all birthdays in a specific month. Use this to see who has birthdays in a particular month.",
	inputSchema: z.object({
		guildId: z.string().describe("The Discord guild ID"),
		month: z
			.number()
			.min(1)
			.max(12)
			.describe("The month to check (1-12)"),
	}),
	outputSchema: z.object({
		success: z.boolean(),
		message: z.string(),
		data: z
			.object({
				birthdays: z.array(
					z.object({
						userId: z.string(),
						birthMonth: z.number(),
						birthDay: z.number(),
						birthYear: z.number().optional(),
					}),
				),
			})
			.optional(),
	}),
	execute: async (input) => {
		return withToolSpan("get-birthdays-by-month", undefined, async () => {
			const monthNames = [
				"January",
				"February",
				"March",
				"April",
				"May",
				"June",
				"July",
				"August",
				"September",
				"October",
				"November",
				"December",
			];
			const monthName = monthNames[input.month - 1];

			logger.debug("Getting birthdays by month", {
				guildId: input.guildId,
				month: input.month,
			});

			try {
				const birthdays = await getBirthdaysByMonth(input.guildId, input.month);

				logger.info("Birthdays by month retrieved", {
					guildId: input.guildId,
					month: input.month,
					count: birthdays.length,
				});

				const birthdayData = birthdays.map((b) => ({
					userId: b.userId,
					birthMonth: b.birthMonth,
					birthDay: b.birthDay,
					birthYear: b.birthYear ?? undefined,
				}));

				return {
					success: true,
					message:
						birthdays.length > 0
							? `Found ${birthdays.length.toString()} birthday(s) in ${monthName ?? "this month"}`
							: `No birthdays in ${monthName ?? "this month"}`,
					data: {
						birthdays: birthdayData,
					},
				};
			} catch (error) {
				logger.error("Failed to get birthdays by month", error, {
					guildId: input.guildId,
					month: input.month,
				});
				captureException(error as Error, {
					operation: "tool.get-birthdays-by-month",
					extra: { guildId: input.guildId, month: input.month },
				});
				return {
					success: false,
					message: `Failed to get birthdays: ${(error as Error).message}`,
				};
			}
		});
	},
});

export const birthdayTools = [
	setBirthdayTool,
	getBirthdayTool,
	updateBirthdayTool,
	deleteBirthdayTool,
	getBirthdaysTodayTool,
	getUpcomingBirthdaysTool,
	getBirthdaysByMonthTool,
];
