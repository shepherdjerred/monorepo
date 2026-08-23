import { SlashCommandBuilder } from "discord.js";

/**
 * `/lobby` — tournament-code custom games.
 *
 * Guild-scoped, never global: it is gated by `tournament_lobbies_enabled`, and
 * a globally registered gated command sits in every guild's picker doing
 * nothing.
 *
 * Teams are two separate free-text options rather than one `players` list.
 * That is not cosmetic — the team split is the one thing lobby events cannot
 * supply (they carry a PUUID per join and never a side) and spectator does not
 * reliably surface custom lobbies, so taking it as command input is what lets
 * the prematch card and the Bryan Bucks market work at all.
 *
 * `teamSize` is derived as max(blue, red) rather than being its own option:
 * two lists and a size field can disagree, and Riot accepts only one number.
 *
 * Free text rather than autocomplete, following `/bb peek` and pinned by
 * definitions.test.ts — matching an alias is a lookup the user can see the
 * result of.
 */
export const lobbyCommand = new SlashCommandBuilder()
  .setName("lobby")
  .setDescription("Create and manage custom-game lobbies")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create a custom game lobby")
      .addStringOption((option) =>
        option
          .setName("blue")
          .setDescription("Comma-separated Scout aliases on blue side")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("red")
          .setDescription("Comma-separated Scout aliases on red side")
          .setRequired(true),
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
