import { createTool } from "@shepherdjerred/birmel/voltagent/tools/create-tool.ts";
import { z } from "zod";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import { captureException } from "@shepherdjerred/birmel/observability/sentry.ts";
import { withToolSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import {
  handleSetBirthday,
  handleGetBirthday,
  handleUpdateBirthday,
  handleDeleteBirthday,
  handleTodayBirthdays,
  handleUpcomingBirthdays,
  handleBirthdaysByMonth,
} from "./birthday-actions.ts";
import { getErrorMessage, toError } from "@shepherdjerred/birmel/utils/errors.ts";

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
    return await withToolSpan("manage-birthday", undefined, async () => {
      try {
        switch (ctx.action) {
          case "set":
            return await handleSetBirthday({
              guildId: ctx.guildId,
              userId: ctx.userId,
              birthMonth: ctx.birthMonth,
              birthDay: ctx.birthDay,
              birthYear: ctx.birthYear,
              timezone: ctx.timezone,
            });
          case "get":
            return await handleGetBirthday(ctx.guildId, ctx.userId);
          case "update":
            return await handleUpdateBirthday({
              guildId: ctx.guildId,
              userId: ctx.userId,
              birthMonth: ctx.birthMonth,
              birthDay: ctx.birthDay,
              birthYear: ctx.birthYear,
              timezone: ctx.timezone,
            });
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
        captureException(toError(error), { operation: "tool.manage-birthday" });
        return {
          success: false,
          message: `Failed: ${getErrorMessage(error)}`,
        };
      }
    });
  },
});

export const birthdayTools = [manageBirthdayTool];
