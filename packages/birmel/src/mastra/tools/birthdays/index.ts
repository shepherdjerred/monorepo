import { createTool } from "../../../voltagent/tools/create-tool.js";
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
import {
  captureException,
  withToolSpan,
} from "../../../observability/index.js";

const logger = loggers.tools.child("birthdays");

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
          case "set": {
            if (!ctx.userId || !ctx.birthMonth || !ctx.birthDay) {
              return {
                success: false,
                message:
                  "userId, birthMonth, and birthDay are required for set",
              };
            }
            const birthday = await createBirthday({
              userId: ctx.userId,
              guildId: ctx.guildId,
              birthMonth: ctx.birthMonth,
              birthDay: ctx.birthDay,
              ...(ctx.birthYear !== undefined && { birthYear: ctx.birthYear }),
              timezone: ctx.timezone ?? "UTC",
            });
            logger.info("Birthday set", {
              guildId: ctx.guildId,
              userId: ctx.userId,
            });
            return {
              success: true,
              message: `Birthday set to ${ctx.birthMonth.toString()}/${ctx.birthDay.toString()}${ctx.birthYear ? `/${ctx.birthYear.toString()}` : ""}`,
              data: {
                userId: birthday.userId,
                birthMonth: birthday.birthMonth,
                birthDay: birthday.birthDay,
                birthYear: birthday.birthYear ?? undefined,
                timezone: birthday.timezone,
              },
            };
          }

          case "get": {
            if (!ctx.userId) {
              return { success: false, message: "userId is required for get" };
            }
            const birthday = await getBirthday(ctx.userId, ctx.guildId);
            if (!birthday) {
              return {
                success: false,
                message: "No birthday found for this user",
              };
            }
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
          }

          case "update": {
            if (!ctx.userId) {
              return {
                success: false,
                message: "userId is required for update",
              };
            }
            const birthday = await updateBirthday(ctx.userId, ctx.guildId, {
              ...(ctx.birthMonth !== undefined && {
                birthMonth: ctx.birthMonth,
              }),
              ...(ctx.birthDay !== undefined && { birthDay: ctx.birthDay }),
              ...(ctx.birthYear !== undefined && { birthYear: ctx.birthYear }),
              ...(ctx.timezone !== undefined && { timezone: ctx.timezone }),
            });
            logger.info("Birthday updated", {
              guildId: ctx.guildId,
              userId: ctx.userId,
            });
            return {
              success: true,
              message: `Birthday updated to ${birthday.birthMonth.toString()}/${birthday.birthDay.toString()}`,
              data: {
                userId: birthday.userId,
                birthMonth: birthday.birthMonth,
                birthDay: birthday.birthDay,
                birthYear: birthday.birthYear ?? undefined,
                timezone: birthday.timezone,
              },
            };
          }

          case "delete": {
            if (!ctx.userId) {
              return {
                success: false,
                message: "userId is required for delete",
              };
            }
            const deleted = await deleteBirthday(ctx.userId, ctx.guildId);
            if (!deleted) {
              return {
                success: false,
                message: "No birthday found for this user",
              };
            }
            logger.info("Birthday deleted", {
              guildId: ctx.guildId,
              userId: ctx.userId,
            });
            return { success: true, message: "Birthday deleted successfully" };
          }

          case "today": {
            const birthdays = await getBirthdaysToday(ctx.guildId);
            const data = birthdays.map((b) => ({
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
              data: { birthdays: data },
            };
          }

          case "upcoming": {
            const days = ctx.daysAhead ?? 7;
            const birthdays = await getUpcomingBirthdays(ctx.guildId, days);
            return {
              success: true,
              message:
                birthdays.length > 0
                  ? `Found ${birthdays.length.toString()} upcoming birthday(s)`
                  : `No birthdays in the next ${days.toString()} days`,
              data: { birthdays },
            };
          }

          case "by-month": {
            if (!ctx.month) {
              return {
                success: false,
                message: "month is required for by-month",
              };
            }
            const birthdays = await getBirthdaysByMonth(ctx.guildId, ctx.month);
            const data = birthdays.map((b) => ({
              userId: b.userId,
              birthMonth: b.birthMonth,
              birthDay: b.birthDay,
              birthYear: b.birthYear ?? undefined,
            }));
            const monthName = monthNames[ctx.month - 1];
            return {
              success: true,
              message:
                birthdays.length > 0
                  ? `Found ${birthdays.length.toString()} birthday(s) in ${monthName ?? "this month"}`
                  : `No birthdays in ${monthName ?? "this month"}`,
              data: { birthdays: data },
            };
          }
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
