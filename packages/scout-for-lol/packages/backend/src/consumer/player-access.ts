import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { resolveConsumerGuildAccess } from "#src/consumer/access.ts";
import { exploreAllowlist } from "#src/explore/access.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";

const PLAYER_PROFILES_FLAG = "scout-consumer-player-profiles-enabled";

export type ConsumerPlayerScopeResult =
  | { kind: "allowed"; guilds: PartialGuild[] }
  | { kind: "forbidden"; reason: "no_shared_guild" | "feature_disabled" }
  | { kind: "unavailable" };

/**
 * Re-evaluate Discord membership and the per-guild rollout flag for every
 * consumer-profile request. No caller may retain this scope between requests.
 */
export async function resolveConsumerPlayerScope(
  user: User,
): Promise<ConsumerPlayerScopeResult> {
  const access = await resolveConsumerGuildAccess(user, exploreAllowlist());
  if (access.kind !== "allowed") {
    return access.kind === "unavailable"
      ? { kind: "unavailable" }
      : { kind: "forbidden", reason: "no_shared_guild" };
  }

  const evaluations = await Promise.all(
    access.guilds.map(async (guild) => ({
      guild,
      enabled: await isPolicyEnabled(PLAYER_PROFILES_FLAG, {
        server: DiscordGuildIdSchema.parse(guild.id),
        environment: configuration.environment,
      }),
    })),
  );
  const guilds = evaluations
    .filter((evaluation) => evaluation.enabled)
    .map((evaluation) => evaluation.guild);
  return guilds.length === 0
    ? { kind: "forbidden", reason: "feature_disabled" }
    : { kind: "allowed", guilds };
}

export async function assertConsumerPlayerScope(
  user: User,
): Promise<PartialGuild[]> {
  const scope = await resolveConsumerPlayerScope(user);
  if (scope.kind === "unavailable") {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Scout could not verify its connected servers. Try again soon.",
    });
  }
  if (scope.kind === "forbidden") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Player profiles are not available for your shared servers.",
    });
  }
  return scope.guilds;
}
