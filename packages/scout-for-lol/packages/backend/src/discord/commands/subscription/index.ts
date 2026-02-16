import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { RegionSchema, toReadableRegion } from "@scout-for-lol/data";

/**
 * Subscription command for managing player subscriptions
 */
export const subscriptionCommand = new SlashCommandBuilder()
  .setName("subscription")
  .setDescription("Manage player subscriptions")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Subscribe to updates for a League of Legends account")
      .addChannelOption((option) =>
        option.setName("channel").setDescription("The channel to post messages to").setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("region")
          .setDescription("The region of the League of Legends account")
          .addChoices(
            RegionSchema.options.map((region) => {
              return { name: toReadableRegion(region), value: region };
            }),
          )
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("riot-id")
          .setDescription("The Riot ID to subscribe to in the format of <name>#<tag>")
          .setRequired(true),
      )
      .addStringOption((option) => option.setName("alias").setDescription("An alias for the player").setRequired(true))
      .addUserOption((option) => option.setName("user").setDescription("The Discord user of the player")),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Stop tracking a player in a channel")
      .addStringOption((option) =>
        option.setName("alias").setDescription("The alias of the player to unsubscribe").setRequired(true),
      )
      .addChannelOption((option) =>
        option.setName("channel").setDescription("The channel to remove the subscription from").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("Lists all users that the server is subscribed to"),
  );
