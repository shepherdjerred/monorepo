import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { REGION_CHOICES } from "@scout-for-lol/backend/discord/commands/admin/utils/region-choices.ts";

/**
 * Admin command for managing players and accounts
 */
export const adminCommand = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("Admin commands for managing players and accounts")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-edit")
      .setDescription("Edit a player's details")
      .addStringOption((option) =>
        option
          .setName("current-alias")
          .setDescription("The current alias of the player")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("new-alias")
          .setDescription("The new alias for the player")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("account-delete")
      .setDescription("Delete an account from a player")
      .addStringOption((option) =>
        option
          .setName("riot-id")
          .setDescription("The Riot ID of the account in format <name>#<tag>")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("region")
          .setDescription("The region of the account")
          .setRequired(true)
          .addChoices(...REGION_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("account-add")
      .setDescription("Add an account to an existing player")
      .addStringOption((option) =>
        option
          .setName("player-alias")
          .setDescription("The alias of the player to add the account to")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("riot-id")
          .setDescription("The Riot ID of the account in format <name>#<tag>")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("region")
          .setDescription("The region of the account")
          .setRequired(true)
          .addChoices(...REGION_CHOICES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("account-transfer")
      .setDescription("Transfer an account from one player to another")
      .addStringOption((option) =>
        option
          .setName("riot-id")
          .setDescription("The Riot ID of the account in format <name>#<tag>")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("region")
          .setDescription("The region of the account")
          .setRequired(true)
          .addChoices(...REGION_CHOICES),
      )
      .addStringOption((option) =>
        option
          .setName("to-player-alias")
          .setDescription("The alias of the player to transfer the account to")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-merge")
      .setDescription(
        "Merge two players into one (combines all accounts and subscriptions)",
      )
      .addStringOption((option) =>
        option
          .setName("source-alias")
          .setDescription(
            "The alias of the player to merge from (will be deleted)",
          )
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("target-alias")
          .setDescription("The alias of the player to merge into (will keep)")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-delete")
      .setDescription(
        "Delete a player and all their accounts and subscriptions",
      )
      .addStringOption((option) =>
        option
          .setName("alias")
          .setDescription("The alias of the player to delete")
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("confirm")
          .setDescription("Type 'true' to confirm deletion (CANNOT BE UNDONE)")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-view")
      .setDescription(
        "View player details (accounts, subscriptions, competitions)",
      )
      .addStringOption((option) =>
        option
          .setName("alias")
          .setDescription("The alias of the player to view")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-link-discord")
      .setDescription("Link a Discord user to a player")
      .addStringOption((option) =>
        option
          .setName("player-alias")
          .setDescription("The alias of the player to link")
          .setRequired(true),
      )
      .addUserOption((option) =>
        option
          .setName("discord-user")
          .setDescription("The Discord user to link to this player")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("player-unlink-discord")
      .setDescription("Unlink a Discord user from a player")
      .addStringOption((option) =>
        option
          .setName("player-alias")
          .setDescription("The alias of the player to unlink")
          .setRequired(true),
      ),
  );
