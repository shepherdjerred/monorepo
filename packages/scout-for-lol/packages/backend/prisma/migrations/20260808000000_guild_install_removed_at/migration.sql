-- Records when guildDelete confirmed the bot was removed from a guild.
-- Cleared on the next install. Distinguishes a genuine re-install (restart
-- onboarding) from a spurious guildCreate for a guild we never left.
ALTER TABLE "GuildInstall" ADD COLUMN "removedAt" DATETIME;
