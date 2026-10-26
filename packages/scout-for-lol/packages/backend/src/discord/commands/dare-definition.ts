import { DARE_MAX_TEXT_LENGTH } from "#src/dares/constants.ts";
import { SlashCommandBuilder } from "discord.js";
export const dareCommand = new SlashCommandBuilder()
  .setName("dare")
  .setDescription("Challenge tracked players to an in-game achievement")
  .addStringOption((option) =>
    option
      .setName("text")
      .setDescription("What you dare them to do")
      .setRequired(true)
      .setMaxLength(DARE_MAX_TEXT_LENGTH),
  );
