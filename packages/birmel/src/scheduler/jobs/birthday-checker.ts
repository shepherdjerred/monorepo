import { toError } from "@shepherdjerred/birmel/utils/errors.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import { getBirthdaysToday } from "@shepherdjerred/birmel/database/repositories/birthdays.ts";
import { withSpan } from "@shepherdjerred/birmel/observability/tracing.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import type { Guild, GuildMember, OAuth2Guild } from "discord.js";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";

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

  if ("send" in channel) {
    await channel.send(birthdayMessage);
  }
  logger.info("Sent birthday message", {
    guildId,
    userId: birthday.userId,
    username,
    channelId,
  });

  await assignBirthdayRole(member, fullGuild, birthday.userId);
}

async function processGuildBirthdays(guild: OAuth2Guild, guildId: string): Promise<void> {
  try {
    const birthdays = await getBirthdaysToday(guildId);
    if (birthdays.length === 0) {
      return;
    }
    logger.info("Found birthdays", { guildId, count: birthdays.length });
    const fullGuild = await guild.fetch();
    for (const birthday of birthdays) {
      try {
        await processBirthday(birthday, fullGuild, guildId);
      } catch (error) {
        logger.error("Failed to process birthday", toError(error), { guildId, userId: birthday.userId });
      }
    }
  } catch (error) {
    logger.error("Failed to check birthdays for guild", toError(error), { guildId });
  }
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
        await processGuildBirthdays(guild, guildId);
      }

      logger.info("Birthday check completed");
    } catch (error) {
      logger.error("Birthday checker job failed", toError(error));
    }
  });
}
