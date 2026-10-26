import type { User } from "#generated/prisma/client/index.js";
import {
  isPolicyEnabled,
  listGuildsWithFlagDeclared,
} from "#src/configuration/flags.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";

export type DaresScopeResult =
  | { kind: "allowed"; guilds: PartialGuild[] }
  | { kind: "forbidden"; reason: "no_shared_guild" | "feature_disabled" };

export async function resolveDaresScope(user: User): Promise<DaresScopeResult> {
  const candidates = listGuildsWithFlagDeclared("dares_enabled");
  if (candidates.length === 0) {
    return { kind: "forbidden", reason: "feature_disabled" };
  }

  const memberGuilds = await fetchUserGuildsForRequest(user);
  const candidateSet = new Set<string>(candidates);
  const shared = memberGuilds.filter((guild) => candidateSet.has(guild.id));
  if (shared.length === 0) {
    return { kind: "forbidden", reason: "no_shared_guild" };
  }

  const evaluations = await Promise.all(
    shared.map(async (guild) => ({
      guild,
      enabled: await isPolicyEnabled("dares_enabled", {
        server: DiscordGuildIdSchema.parse(guild.id),
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

/**
 * Authorize one explicit guild against the caller's resolved scope.
 *
 * Every Dares procedure except the status probe takes a client-supplied
 * `guildId`; none of them may trust it.
 */
export async function assertDaresScope(
  user: User,
  guildId: DiscordGuildId,
): Promise<PartialGuild> {
  const scope = await resolveDaresScope(user);
  if (scope.kind === "forbidden") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bryan Dares is not available for your shared servers.",
    });
  }
  const guild = scope.guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bryan Dares is not available in that server.",
    });
  }
  return guild;
}
