import {
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";

function withStationScopeAndSeed(
  sub: SlashCommandSubcommandBuilder,
  seedDescription: string,
): SlashCommandSubcommandBuilder {
  return sub
    .addStringOption((option) =>
      option.setName("seed").setDescription(seedDescription).setMaxLength(200),
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
    );
}

export const radioCommand = new SlashCommandBuilder()
  .setName("radio")
  .setDescription("Continuous personalized and related music radio")
  .addSubcommand((sub) =>
    withStationScopeAndSeed(
      sub
        .setName("start")
        .setDescription("Start continuous Radio mode in your voice channel"),
      "Optional artist, song, genre, or mood seed",
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

export const tvCommand = new SlashCommandBuilder()
  .setName("tv")
  .setDescription("Continuous tunable TV mode across Plex and YouTube")
  .addSubcommand((sub) =>
    withStationScopeAndSeed(
      sub
        .setName("start")
        .setDescription("Start continuous TV mode in your voice channel")
        .addStringOption((option) =>
          option
            .setName("preset")
            .setDescription("TV channel preset (default: my-mix)")
            .addChoices(
              { name: "my-mix", value: "my-mix" },
              { name: "continue-series", value: "continue-series" },
              { name: "sitcoms", value: "sitcoms" },
              { name: "movies", value: "movies" },
              { name: "youtube", value: "youtube" },
            ),
        ),
      "Optional show, movie, genre, or topic seed",
    ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("Stop TV station refilling in your voice channel"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show active TV station status in your voice channel"),
  );
