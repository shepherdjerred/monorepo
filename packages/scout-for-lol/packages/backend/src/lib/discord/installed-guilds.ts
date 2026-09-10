/**
 * "Is Scout installed in this guild?" — the application port every web request
 * asks instead of reading `client.guilds.cache`.
 *
 * **This promotes `GuildInstall` from an analytics/outreach table to an
 * authorization source.** A row with `removedAt: null` is now part of what
 * decides whether the dashboard answers NOT_FOUND, so its writers
 * (`discord/events/guild-create.ts` sets `removedAt: null`,
 * `analytics/guild-lifecycle.ts` and `guild-delete` set it) are load-bearing
 * for access control, not just reporting. Row *existence* is deliberately not
 * the signal: rows outlive removal on purpose so a re-install can be told from
 * a first install, so an existence check would keep serving a guild that
 * removed Scout months ago.
 *
 * The gateway keeps writing those rows; nothing here reads the gateway. That is
 * the point — a pod serving HTTP with no gateway connection answers the same
 * way as one with a fully backfilled cache.
 *
 * ## Why a negative is re-checked against Discord
 *
 * `GuildInstall` is written by a `guildCreate` handler that swallows its own
 * write failures, and it did not exist for Scout's earliest guilds. A missing
 * row therefore is not proof of absence, and treating it as proof would lock a
 * real server out of its own dashboard with a message saying Scout was never
 * installed — the exact class of wrong answer this whole change exists to
 * remove. So a negative from the table is confirmed against Discord over the
 * bot REST API before it is believed, and a REST failure propagates as
 * {@link DiscordUpstreamError} (⇒ SERVICE_UNAVAILABLE) rather than "not
 * installed".
 *
 * {@link installedGuildIdsAmong} does NOT do that confirmation: it answers for
 * a whole guild picker at once, where one REST call per non-installed guild
 * would mean dozens of requests per page load. The picker is allowed to omit a
 * guild whose row is missing; opening that guild directly still works, because
 * the single-guild path above confirms.
 */

import type { DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { isDevGuildOverrideGuild } from "#src/lib/discord-rest.ts";
import { botRest, type BotRestReader } from "#src/lib/discord/bot-rest.ts";

export type InstalledGuildsDependencies = {
  readonly db: ExtendedPrismaClient;
  readonly rest: BotRestReader;
  /** Local dev-login fixture guilds, which no real Discord answer covers. */
  readonly isDevOverrideGuild: (guildId: string) => boolean;
};

export function defaultInstalledGuildsDependencies(): InstalledGuildsDependencies {
  return {
    db: prisma,
    rest: botRest(),
    isDevOverrideGuild: isDevGuildOverrideGuild,
  };
}

async function hasLiveInstallRow(
  db: ExtendedPrismaClient,
  guildId: string,
): Promise<boolean> {
  const install = await db.guildInstall.findUnique({
    where: { serverId: guildId },
    select: { removedAt: true },
  });
  return install !== null && install.removedAt === null;
}

/**
 * Whether Scout is installed in one guild.
 *
 * Throws {@link DiscordUpstreamError} when the table says no and Discord could
 * not be reached to confirm it — never returns `false` in that case.
 */
export async function isScoutInstalledInGuild(
  guildId: string,
  dependencies: InstalledGuildsDependencies = defaultInstalledGuildsDependencies(),
): Promise<boolean> {
  if (dependencies.isDevOverrideGuild(guildId)) return true;
  if (await hasLiveInstallRow(dependencies.db, guildId)) return true;
  return await dependencies.rest.guildExists(guildId);
}

/**
 * Which of `guildIds` Scout is installed in, from the table alone.
 *
 * One query regardless of input size, and no Discord I/O — see the module
 * docblock for why this half does not confirm negatives.
 */
export async function installedGuildIdsAmong(
  guildIds: readonly string[],
  dependencies: InstalledGuildsDependencies = defaultInstalledGuildsDependencies(),
): Promise<Set<string>> {
  const unique = [...new Set(guildIds)];
  const installed = new Set(
    unique.filter((guildId) => dependencies.isDevOverrideGuild(guildId)),
  );
  if (unique.length === 0) return installed;
  const rows = await dependencies.db.guildInstall.findMany({
    where: { serverId: { in: unique }, removedAt: null },
    select: { serverId: true },
  });
  for (const row of rows) installed.add(row.serverId);
  return installed;
}

/**
 * The guild's name as Scout last recorded it, or `null` when there is no row.
 *
 * `guildCreate` refreshes `serverName` on every install and re-install, so this
 * is the same string the bot's cache used to report, without a gateway.
 */
export async function installedGuildName(
  guildId: DiscordGuildId,
  dependencies: InstalledGuildsDependencies = defaultInstalledGuildsDependencies(),
): Promise<string | null> {
  const install = await dependencies.db.guildInstall.findUnique({
    where: { serverId: guildId },
    select: { serverName: true },
  });
  return install?.serverName ?? null;
}
