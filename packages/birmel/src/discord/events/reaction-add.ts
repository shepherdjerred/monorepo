import type {
  Client,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";
import { recordReactionActivity } from "../../database/repositories/activity.js";
import { loggers } from "../../utils/logger.js";

const logger = loggers.events.child("reaction-add");

export function handleReactionAdd(client: Client) {
  client.on(
    "messageReactionAdd",
    (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser
    ) => {
      void (async () => {
        try {
          // Ignore bot reactions
          if (user.bot) {
            return;
          }

          // Partial reactions need to be fetched
          if (reaction.partial) {
            try {
              await reaction.fetch();
            } catch (error) {
              logger.warn("Failed to fetch partial reaction", { error });
              return;
            }
          }

          // Get guild ID (only track guild reactions, not DMs)
          const guildId = reaction.message.guildId;
          if (!guildId) {
            return;
          }

          const emoji = reaction.emoji.name ?? reaction.emoji.id ?? "unknown";

          // Record reaction activity
          recordReactionActivity({
            guildId,
            userId: user.id,
            channelId: reaction.message.channelId,
            messageId: reaction.message.id,
            emoji,
          });

          logger.debug("Reaction activity recorded", {
            guildId,
            userId: user.id,
            emoji,
          });
        } catch (error) {
          logger.error("Error in reaction add handler", error);
        }
      })();
    }
  );
}
