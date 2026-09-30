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
 * ## The table is never the final word, in either direction
 *
 * `GuildInstall` is maintained by gateway handlers, so it is only as current as
 * the gateway was. Both directions can be stale, and both are confirmed against
 * Discord over the bot REST API:
 *
 * - A **missing or removed row** is not proof of absence. `guildCreate`
 *   swallows its own write failures, and the table did not exist for Scout's
 *   earliest guilds, so believing it would lock a real server out of its own
 *   dashboard with a message saying Scout was never installed.
 * - A **live row** is not proof of presence. A removal that happens while the
 *   gateway is down fires no `guildDelete`, and a `guildDelete` whose cleanup
 *   fails leaves `removedAt` null — so an unconfirmed positive would keep
 *   authorizing dashboard access to a server Scout was thrown out of, for as
 *   long as nobody restarted the bot.
 *
 * ## The failure semantics are deliberately asymmetric
 *
 * What differs between the two directions is what happens when Discord cannot
 * be reached, and the asymmetry is the point:
 *
 * | table | Discord says absent | Discord unreachable |
 * | ----- | ------------------- | ------------------- |
 * | live row | `false` — removal wins | **`true` — trust the row** |
 * | no row   | `false`             | throws ⇒ SERVICE_UNAVAILABLE |
 *
 * A live row plus an unreachable Discord resolves to `true` on purpose. The
 * alternative — 503ing every guild-scoped request whenever Discord blips — takes
 * a working dashboard offline to defend against a stale row, and the worst case
 * of trusting the row is exactly the staleness this system had before the row
 * was consulted at all. With no row there is nothing to fall back on, so the
 * failure has to surface.
 *
 * Either way an outage never becomes "Scout is not installed": in the first case
 * it is invisible, in the second it is reported as an outage.
 *
 * {@link installedGuildIdsAmong} does NOT confirm at all: it answers for a whole
 * guild picker at once, where one REST call per guild would mean dozens of
 * requests per page load. The picker is allowed to be one gateway-write stale in
 * either direction; opening a guild directly still confirms, and every mutation
 * behind it goes through the single-guild path.
 */

import type { DiscordGuildId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  DiscordUpstreamError,
  isDevGuildOverrideGuild,
} from "#src/lib/discord-rest.ts";
import { botRest, type BotRestReader } from "#src/lib/discord/bot-rest.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("installed-guilds");

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
 * Whether Scout is installed in one guild, confirmed against Discord.
 *
 * See the module docblock for the truth table. In short: Discord's answer wins
 * whenever there is one, and when there is not, a live row is trusted while a
 * missing row throws {@link DiscordUpstreamError} (⇒ SERVICE_UNAVAILABLE). This
 * never returns `false` because Scout failed to ask.
 */
export async function isScoutInstalledInGuild(
  guildId: string,
  dependencies: InstalledGuildsDependencies = defaultInstalledGuildsDependencies(),
): Promise<boolean> {
  if (dependencies.isDevOverrideGuild(guildId)) return true;
  const hasRow = await hasLiveInstallRow(dependencies.db, guildId);
  if (!hasRow) {
    // Nothing to fall back on: an unreachable Discord must surface, not deny.
    return await dependencies.rest.guildExists(guildId);
  }
  try {
    return await dependencies.rest.guildExists(guildId);
  } catch (error) {
    if (error instanceof DiscordUpstreamError) {
      logger.warn(
        "Discord could not confirm an installed guild; trusting the GuildInstall row",
        { guildId, reason: error.reason },
      );
      return true;
    }
    throw error;
  }
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
