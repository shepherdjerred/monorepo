import { tool } from "ai";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { clashSurfaceEnabledForGuild } from "#src/league/clash/access.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { readClashHistoryForGuild } from "#src/league/clash/history.ts";
import {
  readClashRosterForGuild,
  readClashSchedule,
} from "#src/league/clash/store.ts";

const ClashToolResultSchema = z.strictObject({
  kind: z.string(),
  message: z.string(),
  data: z.unknown(),
});

export function createClashExploreTools(options: {
  readonly guildIds: readonly string[];
  readonly track: ToolTracker;
}) {
  return {
    get_clash_schedule: tool({
      description:
        "Read the current Clash-v1 tournament snapshot: themes, registration, and start times. Load the clash skill first. This is not match history.",
      inputSchema: z.strictObject({}),
      outputSchema: ClashToolResultSchema,
      execute: () =>
        options.track("get_clash_schedule", async () => {
          const tournaments = await readClashSchedule();
          return {
            kind: "clash_schedule",
            message:
              tournaments.length === 0
                ? "No Clash weekend is posted in the current snapshot."
                : "Upcoming Clash phases from the Clash-v1 snapshot. Current Clash cannot be scored.",
            data: tournaments,
          };
        }),
    }),
    get_clash_roster: tool({
      description:
        "List tracked players registered for Clash in a guild, with team name, tag, and role. Load the clash skill first. This is registration, not results.",
      inputSchema: z.strictObject({
        guildId: DiscordGuildIdSchema.describe(
          "Discord guild id whose tracked players should be listed",
        ),
      }),
      outputSchema: ClashToolResultSchema,
      execute: (input) =>
        options.track("get_clash_roster", async () => {
          if (!options.guildIds.includes(input.guildId)) {
            return {
              kind: "clash_roster",
              message: "That guild is not in this conversation's scope.",
              data: [],
            };
          }
          if (!(await clashSurfaceEnabledForGuild(input.guildId))) {
            return {
              kind: "clash_roster",
              message: "Clash is unavailable in that guild.",
              data: [],
            };
          }
          const teams = await readClashRosterForGuild(input.guildId);
          return {
            kind: "clash_roster",
            message:
              teams.length === 0
                ? "No tracked player in this guild is registered in the current Clash snapshot."
                : "Registered Clash teams among tracked players. There is no bracket or win/loss.",
            data: teams,
          };
        }),
    }),
    get_clash_history: tool({
      description:
        "List Clash lobbies Scout saw for tracked players in a guild, grouped by cup. Current weekends are lobby-only. Finished scores exist only through February 2026. Load the clash skill first.",
      inputSchema: z.strictObject({
        guildId: DiscordGuildIdSchema.describe(
          "Discord guild id whose tracked Clash history should be listed",
        ),
      }),
      outputSchema: ClashToolResultSchema,
      execute: (input) =>
        options.track("get_clash_history", async () => {
          if (!options.guildIds.includes(input.guildId)) {
            return {
              kind: "clash_history",
              message: "That guild is not in this conversation's scope.",
              data: [],
            };
          }
          if (!(await clashSurfaceEnabledForGuild(input.guildId))) {
            return {
              kind: "clash_history",
              message: "Clash is unavailable in that guild.",
              data: [],
            };
          }
          const cups = await readClashHistoryForGuild(input.guildId);
          return {
            kind: "clash_history",
            message:
              cups.length === 0
                ? "No past Clash lobbies for tracked players in this guild yet."
                : "Clash cups Scout saw. Match numbers are lobby order that weekend, not a bracket. Scores appear only on games through February 2026.",
            data: cups,
          };
        }),
    }),
  };
}
