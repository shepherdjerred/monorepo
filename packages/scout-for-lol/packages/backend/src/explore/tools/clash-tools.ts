import { tool } from "ai";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
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
  };
}
