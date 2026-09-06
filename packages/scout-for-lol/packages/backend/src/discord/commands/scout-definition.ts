import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { EXPLORE_QUESTION_MAX_LENGTH } from "@scout-for-lol/data";

/**
 * Which `/scout` features one guild's registration carries. `ask` follows the
 * Explore allowlist; `voice` follows the `voice_assistant_enabled` flag. The
 * guild command is the merge of whichever are on — a guild with only one
 * feature never sees the other's subcommands in its picker.
 */
export type ScoutGuildFeatures = {
  readonly ask: boolean;
  readonly voice: boolean;
};

function buildScoutCommand(features: ScoutGuildFeatures) {
  const command = new SlashCommandBuilder()
    .setName("scout")
    .setDescription("Ask Scout about League of Legends");
  if (features.ask) {
    command.addSubcommand((subcommand) =>
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
  if (features.voice) {
    command.addSubcommand((subcommand) =>
      subcommand
        .setName("join")
        .setDescription(
          'Have Scout join your voice channel and answer "Hey Scout" questions',
        ),
    );
    command.addSubcommand((subcommand) =>
      subcommand
        .setName("leave")
        .setDescription("Have Scout leave the voice channel"),
    );
  }
  return command;
}

/**
 * Per-guild beta registration: the merge of the guild's enabled features.
 * Guild-scoped registration must omit global-only command fields. Callers
 * never pass `{ask: false, voice: false}` — an all-off guild is simply not in
 * the group's registration set.
 */
export function buildScoutGuildCommand(features: ScoutGuildFeatures) {
  return buildScoutCommand(features);
}

/** The complete guild-variant shape (every subcommand), for tests and audits. */
export const scoutGuildCommand = buildScoutGuildCommand({
  ask: true,
  voice: true,
});

/**
 * Production is global, but remains unavailable to DMs and user installs.
 * Voice is beta-only (`voice_assistant_enabled` is production-hard-disabled),
 * so the global variant carries `ask` alone.
 */
export const scoutGlobalCommand = buildScoutCommand({ ask: true, voice: false })
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .setContexts(InteractionContextType.Guild);
