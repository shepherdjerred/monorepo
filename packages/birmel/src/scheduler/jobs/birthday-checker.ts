import { getDiscordClient } from "../../discord/index.js";
import { getBirthdaysToday } from "../../database/repositories/birthdays.js";
import { withSpan } from "../../observability/index.js";
import { loggers } from "../../utils/logger.js";
import type { TextChannel, Guild, GuildMember } from "discord.js";
import { getConfig } from "../../config/index.js";

const logger = loggers.scheduler.child("birthday-checker");

function scheduleBirthdayRoleRemoval(
  fullGuild: Guild,
  userId: string,
  birthdayRoleId: string,
): void {
  setTimeout(
    () => {
      void (async () => {
        try {
          const memberToUpdate = await fullGuild.members.fetch(userId);
          await memberToUpdate.roles.remove(birthdayRoleId);
          logger.info("Removed birthday role", {
            userId,
            roleId: birthdayRoleId,
          });
        } catch (error) {
          logger.warn("Failed to remove birthday role", { userId, error });
        }
      })();
    },
    24 * 60 * 60 * 1000,
  );
}

async function assignBirthdayRole(
  member: GuildMember,
  fullGuild: Guild,
  userId: string,
): Promise<void> {
  const birthdayRoleId = getConfig().birthdays.birthdayRoleId;
  if (birthdayRoleId == null || birthdayRoleId.length === 0) {
    return;
  }

  try {
    await member.roles.add(birthdayRoleId);
    logger.info("Added birthday role", { userId, roleId: birthdayRoleId });
    scheduleBirthdayRoleRemoval(fullGuild, userId, birthdayRoleId);
  } catch (error) {
    logger.warn("Failed to add birthday role", { userId, error });
  }
}

async function processBirthday(
  birthday: { userId: string; birthYear: number | null },
  fullGuild: Guild,
  guildId: string,
): Promise<void> {
  const client = getDiscordClient();
  const config = getConfig();
  const member = await fullGuild.members.fetch(birthday.userId);
  const username = member.user.username;

  let ageText = "";
  if (birthday.birthYear != null) {
    const age = new Date().getFullYear() - birthday.birthYear;
    ageText = ` (${age.toString()} years old)`;
  }

  const birthdayMessage = `🎉🎂 Happy Birthday to <@${birthday.userId}>!${ageText} 🎂🎉`;

  let channelId = config.birthdays.announcementChannelId;
  channelId ??= fullGuild.systemChannelId ?? undefined;

  if (channelId == null || channelId.length === 0) {
    logger.warn("No channel available for birthday message", {
      guildId,
      userId: birthday.userId,
    });
    return;
  }

  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true) {
    return;
  }

  await (channel as TextChannel).send(birthdayMessage);
  logger.info("Sent birthday message", {
    guildId,
    userId: birthday.userId,
    username,
    channelId,
  });

  await assignBirthdayRole(member, fullGuild, birthday.userId);
}

/**
 * Check for birthdays today and send celebration messages
 * Runs daily at a configured time (default: 09:00 UTC)
 */
export async function checkAndPostBirthdays(): Promise<void> {
  return withSpan("job.check-birthdays", {}, async () => {
    try {
      logger.info("Starting birthday check");

      const guilds = await getDiscordClient().guilds.fetch();

      for (const [guildId, guild] of guilds) {
        try {
          const birthdays = await getBirthdaysToday(guildId);
          if (birthdays.length === 0) {
            continue;
          }

          logger.info("Found birthdays", { guildId, count: birthdays.length });
          const fullGuild = await guild.fetch();

          for (const birthday of birthdays) {
            try {
              await processBirthday(birthday, fullGuild, guildId);
            } catch (error) {
              logger.error("Failed to process birthday", error as Error, {
                guildId,
                userId: birthday.userId,
              });
            }
          }
        } catch (error) {
          logger.error("Failed to check birthdays for guild", error as Error, {
            guildId,
          });
        }
      }

      logger.info("Birthday check completed");
    } catch (error) {
      logger.error("Birthday checker job failed", error as Error);
    }
  });
}
