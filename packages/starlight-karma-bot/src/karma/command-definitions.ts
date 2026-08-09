/** Slash command shape, kept apart from the handlers.
 *
 *  `rest.ts` needs only the payload, and the handlers pull in the Discord
 *  client (which logs in at import time). Splitting them means the command
 *  definition can be built and inspected without a live connection. */
import { ChannelType, SlashCommandBuilder } from "discord.js";
import {
  ALLOWED_KARMA_AMOUNTS,
  KARMA_GIVE_AMOUNT,
  LEADERBOARD_PERIODS,
} from "#src/karma/scoring.ts";
import { LEADERBOARD_KINDS } from "#src/karma/leaderboard-kinds.ts";

export const karmaCommand = new SlashCommandBuilder()
  .setName("karma")
  .setDescription("Recognize positive contributions with karma points")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("give")
      .setDescription("Give karma to someone")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("The person you'd like to give karma to")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("An optional reason about why they deserve karma")
          .setMaxLength(200),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription(
            `How much karma to give (default ${String(KARMA_GIVE_AMOUNT)})`,
          )
          // A closed choice list, so Discord itself rejects anything else and
          // the amount cannot inflate. `scoring.ts` re-validates because the
          // context menu and any future surface do not get this for free.
          .addChoices(
            ...ALLOWED_KARMA_AMOUNTS.map((amount) => ({
              name: String(amount),
              value: amount,
            })),
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("leaderboard")
      .setDescription("See karma values for everyone on the server")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Rank by karma received or karma given")
          .addChoices(
            { name: "received", value: LEADERBOARD_KINDS[0] },
            { name: "most generous", value: LEADERBOARD_KINDS[1] },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("period")
          .setDescription("Limit the board to a time window")
          .addChoices(
            ...LEADERBOARD_PERIODS.map((period) => ({
              name: period === "all" ? "all time" : `this ${period}`,
              value: period,
            })),
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("check")
      .setDescription("See how much karma someone has")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("Whose karma to check (defaults to you)"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("stats")
      .setDescription("A karma profile: totals, rank, and who gives you most")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("Whose profile to show (defaults to you)"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("why")
      .setDescription("See what someone earned their karma for")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("Whose reasons to show")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("search")
      .setDescription("Search karma reasons for a word or phrase")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("What to look for")
          .setRequired(true)
          .setMaxLength(100),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("undo")
      .setDescription("Take back the karma you just gave"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("config")
      .setDescription("Configure the scheduled karma recap (Manage Server)")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post the recap")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addBooleanOption((option) =>
        option.setName("enabled").setDescription("Turn the recap on or off"),
      )
      .addStringOption((option) =>
        option
          .setName("cron")
          .setDescription("CRON schedule in UTC (default: Fridays 17:00)")
          .setMaxLength(100),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("history")
      .setDescription("View recent changes to a person's karma")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("The person whose karma history you'd like to view")
          .setRequired(true),
      ),
  );
