import { SlashCommandBuilder } from "discord.js";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import {
  DARE_MAX_TEXT_LENGTH,
  MINIMUM_BUCKS_TRANSFER,
} from "#src/betting/constants.ts";

// AI analysis of Bryan Bucks data lives in `/scout ask`, which carries the
// betting tools in this guild; `/bb` keeps the fixed read-only surfaces.
export const bbCommand = new SlashCommandBuilder()
  .setName("bb")
  .setDescription("Bryan Bucks — balances, history, rules, and prizes")
  .addSubcommand((sub) =>
    sub.setName("balance").setDescription("Check your Bryan Bucks balance"),
  )
  .addSubcommand((sub) =>
    sub.setName("prizes").setDescription("See what your Bryan Bucks can buy"),
  )
  .addSubcommand((sub) =>
    sub.setName("rules").setDescription("How Bryan Bucks works"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("history")
      .setDescription("How you earned and spent your Bryan Bucks"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("transfer")
      .setDescription("Send Bryan Bucks through Western Union")
      .addUserOption((option) =>
        option
          .setName("recipient")
          .setDescription("Who receives half of the amount")
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Your total whole-BB spend")
          .setRequired(true)
          .setMinValue(MINIMUM_BUCKS_TRANSFER)
          .setMaxValue(BUCKS_INT32_MAX),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("dare")
      .setDescription("Put a Bryan Bucks bounty on tracked players")
      .addStringOption((option) =>
        option
          .setName("dare")
          .setDescription("What you dare them to do, in your own words")
          .setRequired(true)
          .setMaxLength(DARE_MAX_TEXT_LENGTH),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Your opening whole-BB contribution to the pot")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(BUCKS_INT32_MAX),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("notifications")
      .setDescription("Choose which Bryan Bucks DMs you receive")
      .addStringOption((option) =>
        option
          .setName("your_bets")
          .setDescription("DMs about bets you placed")
          .addChoices(
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("bets_on_you")
          .setDescription("DMs about bets other users placed on you")
          .addChoices(
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("dare_lifecycle")
          .setDescription("DMs when a Dare changes lifecycle state")
          .addChoices(
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("dare_progress")
          .setDescription("DMs when a Dare makes material progress")
          .addChoices(
            { name: "On", value: "on" },
            { name: "Off", value: "off" },
          ),
      ),
  );
