import { SlashCommandBuilder } from "discord.js";
import { EXPLORE_QUESTION_MAX_LENGTH } from "@scout-for-lol/data";

export const scoutCommand = new SlashCommandBuilder()
  .setName("scout")
  .setDescription("Ask Scout a question about League match data")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ask")
      .setDescription("Ask a saved, one-shot Explore question")
      .addStringOption((option) =>
        option
          .setName("question")
          .setDescription("What do you want to learn from Scout's match data?")
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(EXPLORE_QUESTION_MAX_LENGTH),
      ),
  );
