import { TRPCError } from "@trpc/server";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import {
  isPolicyEnabled,
  listGuildsWithFlagDeclared,
} from "#src/configuration/flags.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

export type BucksScopeResult =
  | { kind: "allowed"; guilds: PartialGuild[] }
  | { kind: "forbidden"; reason: "no_shared_guild" | "feature_disabled" };

/**
 * The guilds in which this signed-in user may see or move Bryan Bucks.
 *
 * Candidates come from the same flag registry that decides where the `/bb`
 * guild command is registered, so the two web and Discord surfaces cannot
 * disagree about where the feature exists. Production's hard-disable empties
 * that list before any Discord round-trip. The surviving candidates are
 * intersected with the caller's live Discord membership and then re-checked
 * through `isPolicyEnabled` with the same `{ server }` attributes the betting
 * mutations use, so this probe can never say yes where `placeBet` would answer
 * `feature_disabled`.
 *
 * Re-evaluated per request; no caller may retain this scope between requests.
 */
export async function resolveBucksScope(user: User): Promise<BucksScopeResult> {
  const candidates = listGuildsWithFlagDeclared("betting_enabled");
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
      enabled: await isPolicyEnabled("betting_enabled", {
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
 * Every Bucks procedure except the status probe takes a client-supplied
 * `guildId`; none of them may trust it.
 */
export async function assertBucksScope(
  user: User,
  guildId: DiscordGuildId,
): Promise<PartialGuild> {
  const scope = await resolveBucksScope(user);
  if (scope.kind === "forbidden") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bryan Bucks is not available for your shared servers.",
    });
  }
  const guild = scope.guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bryan Bucks is not available in that server.",
    });
  }
  return guild;
}
