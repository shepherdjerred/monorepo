import { SlashCommandBuilder } from "discord.js";

export const radioCommand = new SlashCommandBuilder()
  .setName("radio")
  .setDescription("Continuous personalized and related music radio")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start continuous Radio mode in your voice channel")
      .addStringOption((option) =>
        option
          .setName("seed")
          .setDescription("Optional artist, song, genre, or mood seed")
          .setMaxLength(200),
      )
      .addStringOption((option) =>
        option
          .setName("scope")
          .setDescription(
            "Blend room listeners, only your taste, or server history",
          )
          .addChoices(
            { name: "room", value: "room" },
            { name: "mine", value: "mine" },
            { name: "server", value: "server" },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("Stop Radio station refilling in your voice channel"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show active Radio station status in your voice channel"),
  );
