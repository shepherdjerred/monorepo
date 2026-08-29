import { SlashCommandBuilder } from "discord.js";

/**
 * `/lobby` — tournament-code custom games.
 *
 * Guild-scoped, never global: it is gated by `tournament_lobbies_enabled`, and
 * a globally registered gated command sits in every guild's picker doing
 * nothing.
 *
 * A tournament code can be open: its recipient decides who to invite from the
 * League client, rather than having to prepare a Scout roster first. Lobby
 * events tell Scout who actually joined, but not which side they chose, so an
 * open lobby has no preassigned-team card or pregame Bryan Bucks market.
 */
export const lobbyCommand = new SlashCommandBuilder()
  .setName("lobby")
  .setDescription("Create and manage custom-game lobbies")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a custom game lobby")
      .addIntegerOption((option) =>
        option
          .setName("size")
          .setDescription("Players on each team (default 5)")
          .addChoices(
            { name: "1v1", value: 1 },
            { name: "2v2", value: 2 },
            { name: "3v3", value: 3 },
            { name: "4v4", value: 4 },
            { name: "5v5", value: 5 },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("region")
          .setDescription("League region (default North America)")
          .addChoices(
            { name: "Brazil", value: "BRAZIL" },
            { name: "Europe East", value: "EU_EAST" },
            { name: "Europe West", value: "EU_WEST" },
            { name: "Japan", value: "JAPAN" },
            { name: "Korea", value: "KOREA" },
            { name: "Latin North", value: "LAT_NORTH" },
            { name: "Latin South", value: "LAT_SOUTH" },
            { name: "North America", value: "AMERICA_NORTH" },
            { name: "Oceania", value: "OCEANIA" },
            { name: "Public Beta Environment", value: "PBE" },
            { name: "Russia", value: "RUSSIA" },
            { name: "Singapore", value: "SINGAPORE" },
            { name: "Taiwan", value: "TAIWAN" },
            { name: "Turkey", value: "TURKEY" },
            { name: "Vietnam", value: "VIETNAM" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("pick")
          .setDescription("Pick type (default tournament draft)")
          .addChoices(
            { name: "Tournament draft", value: "TOURNAMENT_DRAFT" },
            { name: "Draft", value: "DRAFT_MODE" },
            { name: "Blind pick", value: "BLIND_PICK" },
            { name: "All random", value: "ALL_RANDOM" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("map")
          .setDescription("Map (default Summoner's Rift)")
          .addChoices(
            { name: "Summoner's Rift", value: "SUMMONERS_RIFT" },
            { name: "Howling Abyss", value: "HOWLING_ABYSS" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("status")
      .setDescription("Show this server's custom game lobbies"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cancel")
      .setDescription("Cancel a custom game lobby")
      .addStringOption((option) =>
        option
          .setName("code")
          .setDescription("The tournament code to cancel")
          .setRequired(true),
      ),
  );
