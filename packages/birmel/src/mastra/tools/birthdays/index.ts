import { createTool } from "../../../voltagent/tools/create-tool.js";
import { z } from "zod";
import { loggers } from "../../../utils/logger.js";
import {
  captureException,
  withToolSpan,
} from "../../../observability/index.js";
import {
  handleSetBirthday,
  handleGetBirthday,
  handleUpdateBirthday,
  handleDeleteBirthday,
  handleTodayBirthdays,
  handleUpcomingBirthdays,
  handleBirthdaysByMonth,
} from "./birthday-actions.js";

const logger = loggers.tools.child("birthdays");

export const manageBirthdayTool = createTool({
  id: "manage-birthday",
  description:
    "Manage birthdays: set, get, update, delete, get today's, get upcoming, or get by month",
  inputSchema: z.object({
    guildId: z.string().describe("The Discord guild ID"),
    action: z
      .enum(["set", "get", "update", "delete", "today", "upcoming", "by-month"])
      .describe("The action to perform"),
    userId: z
      .string()
      .optional()
      .describe("User ID (for set/get/update/delete)"),
    birthMonth: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe("Birth month 1-12"),
    birthDay: z.number().min(1).max(31).optional().describe("Birth day 1-31"),
    birthYear: z.number().optional().describe("Birth year (optional)"),
    timezone: z.string().optional().describe("Timezone (default: UTC)"),
    daysAhead: z
      .number()
      .min(1)
      .max(365)
      .optional()
      .describe("Days to look ahead (for upcoming)"),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe("Month to query (for by-month)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    data: z
      .union([
        z.object({
          userId: z.string(),
          birthMonth: z.number(),
          birthDay: z.number(),
          birthYear: z.number().optional(),
          timezone: z.string(),
        }),
        z.object({
          birthdays: z.array(
            z.object({
              userId: z.string(),
              birthMonth: z.number(),
              birthDay: z.number(),
              birthYear: z.number().optional(),
              daysUntil: z.number().optional(),
            }),
          ),
        }),
      ])
      .optional(),
  }),
  execute: async (ctx) => {
    return withToolSpan("manage-birthday", undefined, async () => {
      try {
        switch (ctx.action) {
          case "set":
            return await handleSetBirthday(
              ctx.guildId,
              ctx.userId,
              ctx.birthMonth,
              ctx.birthDay,
              ctx.birthYear,
              ctx.timezone,
            );
          case "get":
            return await handleGetBirthday(ctx.guildId, ctx.userId);
          case "update":
            return await handleUpdateBirthday(
              ctx.guildId,
              ctx.userId,
              ctx.birthMonth,
              ctx.birthDay,
              ctx.birthYear,
              ctx.timezone,
            );
          case "delete":
            return await handleDeleteBirthday(ctx.guildId, ctx.userId);
          case "today":
            return await handleTodayBirthdays(ctx.guildId);
          case "upcoming":
            return await handleUpcomingBirthdays(ctx.guildId, ctx.daysAhead);
          case "by-month":
            return await handleBirthdaysByMonth(ctx.guildId, ctx.month);
        }
      } catch (error) {
        logger.error("Failed to manage birthday", error);
        captureException(error as Error, { operation: "tool.manage-birthday" });
        return {
          success: false,
          message: `Failed: ${(error as Error).message}`,
        };
      }
    });
  },
});

export const birthdayTools = [manageBirthdayTool];
