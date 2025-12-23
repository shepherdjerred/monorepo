import { getDiscordClient } from "../../discord/index.js";
import { getBirthdaysToday } from "../../database/repositories/birthdays.js";
import { withSpan } from "../../observability/index.js";
import { loggers } from "../../utils/logger.js";
import type { TextChannel } from "discord.js";
import { getConfig } from "../../config/index.js";

const logger = loggers.scheduler.child("birthday-checker");

/**
 * Check for birthdays today and send celebration messages
 * Runs daily at a configured time (default: 09:00 UTC)
 */
export async function checkAndPostBirthdays(): Promise<void> {
  return withSpan("job.check-birthdays", {}, async () => {
    try {
      logger.info("Starting birthday check");

      const client = getDiscordClient();
      const config = getConfig();

      // Get all guilds the bot is in
      const guilds = await client.guilds.fetch();

      for (const [guildId, guild] of guilds) {
        try {
          const birthdays = await getBirthdaysToday(guildId);

          if (birthdays.length === 0) {
            continue;
          }

          logger.info("Found birthdays", {
            guildId,
            count: birthdays.length
          });

          // Fetch full guild data
          const fullGuild = await guild.fetch();

          for (const birthday of birthdays) {
            try {
              // Fetch member to get username
              const member = await fullGuild.members.fetch(birthday.userId);
              const username = member.user.username;

              // Determine age if birthYear is available
              let ageText = "";
              if (birthday.birthYear) {
                const age = new Date().getFullYear() - birthday.birthYear;
                ageText = ` (${age.toString()} years old)`;
              }

              const birthdayMessage = `🎉🎂 Happy Birthday to <@${birthday.userId}>!${ageText} 🎂🎉`;

              // Try to get configured channel, fallback to system channel or first text channel
              let channelId = config.birthdays.announcementChannelId;

              // Use system channel or first available text channel if no configured channel
              channelId ??= fullGuild.systemChannelId ?? undefined;

              if (channelId) {
                const channel = await client.channels.fetch(channelId);

                if (channel?.isTextBased()) {
                  await (channel as TextChannel).send(birthdayMessage);

                  logger.info("Sent birthday message", {
                    guildId,
                    userId: birthday.userId,
                    username,
                    channelId
                  });

                  // Optionally assign birthday role if configured
                  const birthdayRoleId = config.birthdays.birthdayRoleId;
                  if (birthdayRoleId) {
                    try {
                      await member.roles.add(birthdayRoleId);
                      logger.info("Added birthday role", {
                        userId: birthday.userId,
                        roleId: birthdayRoleId
                      });

                      // Schedule role removal after 24 hours
                      setTimeout(() => {
                        void (async () => {
                          try {
                            const memberToUpdate = await fullGuild.members.fetch(birthday.userId);
                            await memberToUpdate.roles.remove(birthdayRoleId);
                            logger.info("Removed birthday role", {
                              userId: birthday.userId,
                              roleId: birthdayRoleId
                            });
                          } catch (error) {
                            logger.warn("Failed to remove birthday role", {
                              userId: birthday.userId,
                              error
                            });
                          }
                        })();
                      }, 24 * 60 * 60 * 1000); // 24 hours
                    } catch (error) {
                      logger.warn("Failed to add birthday role", {
                        userId: birthday.userId,
                        error
                      });
                    }
                  }
                }
              } else {
                logger.warn("No channel available for birthday message", {
                  guildId,
                  userId: birthday.userId
                });
              }
            } catch (error) {
              logger.error("Failed to process birthday", error as Error, {
                guildId,
                userId: birthday.userId
              });
            }
          }
        } catch (error) {
          logger.error("Failed to check birthdays for guild", error as Error, {
            guildId
          });
        }
      }

      logger.info("Birthday check completed");
    } catch (error) {
      logger.error("Birthday checker job failed", error as Error);
    }
  });
}
