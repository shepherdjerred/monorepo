import type { User } from "#generated/prisma/client/index.js";
import type { Environment } from "#src/configuration.ts";
import configuration from "#src/configuration.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

/**
 * Stage-aware membership boundary shared by Scout's signed-in consumer tools.
 *
 * Beta is deliberately limited to the Explore allowlist. Production uses the
 * bot's live guild cache, because the connected guilds are the authoritative
 * set of communities in which Scout can have recorded data. An unavailable
 * production cache is distinct from an authoritative denial.
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

/** Re-fetch membership for each request and retain Discord display context. */
export async function resolveConsumerGuildAccess(
  user: User,
  betaGuildIds: string[],
): Promise<ConsumerGuildAccessResult> {
  const guilds = await fetchUserGuildsForRequest(user);
  let connectedGuildIds: Iterable<string> | undefined;
  if (configuration.environment === "prod") {
    const guildMembership =
      await import("#src/discord/utils/guild-membership.ts");
    connectedGuildIds = guildMembership.getConnectedServerIds();
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
