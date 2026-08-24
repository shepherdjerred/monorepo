import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { EXPLORE_QUESTION_MAX_LENGTH } from "@scout-for-lol/data";

function buildScoutCommand() {
  return new SlashCommandBuilder()
    .setName("scout")
    .setDescription("Ask Scout a question about League match data")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ask")
        .setDescription("Ask a saved, one-shot Explore question")
        .addStringOption((option) =>
          option
            .setName("question")
            .setDescription(
              "What do you want to learn from Scout's match data?",
            )
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(EXPLORE_QUESTION_MAX_LENGTH),
        ),
    );
}

/** Guild-scoped beta registration must omit global-only command fields. */
export const scoutGuildCommand = buildScoutCommand();

/** Production is global, but remains unavailable to DMs and user installs. */
export const scoutGlobalCommand = buildScoutCommand()
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild);
