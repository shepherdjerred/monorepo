import { SlashCommandBuilder } from "discord.js";
import { MIN_STAKE } from "#src/betting/constants.ts";
import { BB_ASK_MAX_QUESTION_LENGTH } from "#src/discord/commands/bb-ask.ts";
import { addBbPeekSubcommands } from "#src/discord/commands/bb-peek.ts";

export const bbCommand = addBbPeekSubcommands(
  new SlashCommandBuilder()
    .setName("bb")
    .setDescription("Bryan Bucks — betting, balances, prizes, and analysis")
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
      sub.setName("open").setDescription("Games you can still bet on"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ask")
        .setDescription("Ask a question about Bryan Bucks statistics")
        .addStringOption((option) =>
          option
            .setName("question")
            .setDescription("What you want to know about Bryan Bucks")
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(BB_ASK_MAX_QUESTION_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("bet")
        .setDescription("Bet on a tracked player's game")
        .addStringOption((option) =>
          option
            .setName("game")
            .setDescription("A tracked player in the game")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("outcome")
            // Four static choices, because slash-command choices are frozen at
            // registration and cannot vary per game. Blue/Red resolve without
            // knowing the game, which is what covers the rare lobby with
            // tracked players on both teams.
            .setDescription(
              "Win or lose for the tracked player — or pick a side",
            )
            .setRequired(true)
            .addChoices(
              { name: "Win", value: "win" },
              { name: "Lose", value: "lose" },
              { name: "Blue", value: "blue" },
              { name: "Red", value: "red" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("How many whole Bryan Bucks")
            .setRequired(true)
            .setMinValue(MIN_STAKE),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("parlay")
        .setDescription("Bet YES or NO on a tracked player's live parlay")
        .addStringOption((option) =>
          option
            .setName("player")
            .setDescription("A tracked player in the parlay")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("side")
            .setDescription("Whether every parlay leg will hit")
            .setRequired(true)
            .addChoices(
              { name: "YES", value: "YES" },
              { name: "NO", value: "NO" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription("How many whole Bryan Bucks")
            .setRequired(true)
            .setMinValue(MIN_STAKE),
        ),
    ),
);
