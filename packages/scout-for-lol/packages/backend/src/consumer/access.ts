import type { User } from "#generated/prisma/client/index.js";
import type { Environment } from "#src/configuration.ts";
import configuration from "#src/configuration.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import type { InstalledGuildsDependencies } from "#src/lib/discord/installed-guilds.ts";
import { createLogger } from "#src/logger.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

const logger = createLogger("consumer-access");

/**
 * Stage-aware membership boundary shared by Scout's signed-in consumer tools.
 *
 * Beta is deliberately limited to the Explore allowlist. Production uses the
 * guilds Scout is installed in, because those are the authoritative set of
 * communities in which Scout can have recorded data. An unavailable
 * production answer is distinct from an authoritative denial.
 */

export type ConsumerAccessResult =
  | { kind: "allowed"; guildIds: string[] }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

export function eligibleConsumerGuildIds(
  allowedGuildIds: Iterable<string>,
  userGuildIds: string[],
): string[] {
  const allowed = new Set(allowedGuildIds);
  return userGuildIds.filter((guildId) => allowed.has(guildId));
}

export function resolveConsumerAccess(
  environment: Environment,
  betaGuildIds: string[],
  userGuildIds: string[],
  connectedGuildIds: Iterable<string> | undefined,
): ConsumerAccessResult {
  let allowedGuildIds: Iterable<string>;
  if (environment === "prod") {
    if (connectedGuildIds === undefined) {
      return { kind: "unavailable" };
    }
    allowedGuildIds = connectedGuildIds;
  } else {
    allowedGuildIds = betaGuildIds;
  }

  const guildIds = eligibleConsumerGuildIds(allowedGuildIds, userGuildIds);
  return guildIds.length === 0
    ? { kind: "forbidden" }
    : { kind: "allowed", guildIds };
}

export type ConsumerGuildAccessResult =
  | { kind: "allowed"; guilds: PartialGuild[] }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

/**
 * Which of the caller's servers Scout is installed in.
 *
 * The install port, not `client.guilds.cache`. This runs on the HTTP surface,
 * which on a split deployment holds no gateway connection at all — and even on
 * the single pod an unready cache made every restart answer `unavailable` for
 * its first seconds.
 */
export type InstalledGuildLookup = (
  guildIds: string[],
) => Promise<Iterable<string>>;

/**
 * The table narrows; Discord confirms.
 *
 * `installedGuildIdsAmong` alone is picker semantics: it answers from
 * `GuildInstall` rows without asking Discord, which is fine for *offering* a
 * guild and wrong for *granting* one. Rows outlive a removal on purpose, and
 * `guildDelete` swallows its own write failures, so a stale row would hand a
 * caller access to a server Scout has already left.
 *
 * So the query is the narrowing step — one round trip, reducing the caller's
 * whole guild list to the few that could possibly grant — and every survivor is
 * then confirmed through {@link isScoutInstalledInGuild}. That call is bounded
 * by the port's 60-second `guildExists` cache, which is keyed by guild and
 * shared across callers, so a busy server costs one REST read a minute rather
 * than one per request.
 *
 * Every candidate here has a live row by construction, so an unreachable
 * Discord takes the port's documented asymmetry: the row is trusted and a
 * warning is logged, rather than locking a real member out during an outage.
 */
export async function confirmedInstalledAmong(
  guildIds: string[],
  dependencies?: InstalledGuildsDependencies,
): Promise<Iterable<string>> {
  const { installedGuildIdsAmong, isScoutInstalledInGuild } =
    await import("#src/lib/discord/installed-guilds.ts");
  const candidates = await installedGuildIdsAmong(guildIds, dependencies);
  const confirmed: string[] = [];
  for (const guildId of candidates) {
    if (await isScoutInstalledInGuild(guildId, dependencies)) {
      confirmed.push(guildId);
    }
  }
  return confirmed;
}

/**
 * Ask which guilds Scout is installed in, or report that it could not be asked.
 *
 * `undefined` means "no answer", which {@link resolveConsumerAccess} turns into
 * `unavailable`. That distinction is the whole point: an unreachable install
 * source must not become a denial telling a real member they have no access.
 */
export async function installedGuildIdsOrUnavailable(
  guildIds: string[],
  installedGuilds: InstalledGuildLookup,
): Promise<Iterable<string> | undefined> {
  try {
    return await installedGuilds(guildIds);
  } catch (error) {
    logger.warn("Could not resolve installed guilds for consumer access", {
      error,
    });
    return undefined;
  }
}

/** Re-fetch membership for each request and retain Discord display context. */
export async function resolveConsumerGuildAccess(
  user: User,
  betaGuildIds: string[],
  installedGuilds: InstalledGuildLookup = confirmedInstalledAmong,
): Promise<ConsumerGuildAccessResult> {
  const guilds = await fetchUserGuildsForRequest(user);
  let connectedGuildIds: Iterable<string> | undefined;
  if (configuration.environment === "prod") {
    connectedGuildIds = await installedGuildIdsOrUnavailable(
      guilds.map((guild) => guild.id),
      installedGuilds,
    );
  }
  const access = resolveConsumerAccess(
    configuration.environment,
    betaGuildIds,
    guilds.map((guild) => guild.id),
    connectedGuildIds,
  );
  if (access.kind !== "allowed") return access;

  const eligible = new Set(access.guildIds);
  return {
    kind: "allowed",
    guilds: guilds.filter((guild) => eligible.has(guild.id)),
  };
}
