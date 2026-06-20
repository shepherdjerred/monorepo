/**
 * Riot ID helpers for the web UI add flows.
 *
 * - `resolveRiotIdExact`: exact Riot ID → PUUID/canonical name lookup, used
 *   to confirm a typed Riot ID before committing a subscription/account.
 *   Riot's Account API only supports exact match, so there is no server-side
 *   fuzzy search against Riot itself.
 * - `searchKnownAccounts`: fuzzy substring search over accounts already
 *   stored in this guild (by alias or cached Riot game name), for quickly
 *   finding an existing account.
 */

import { z } from "zod";
import { RegionSchema, RiotIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { resolveRiotIdToPuuid } from "#src/lib/subscription/resolve.ts";
import {
  assertAdmin,
  GuildIdInput,
  type WebCtx,
} from "#src/lib/player-admin/shared.ts";

export const ResolveRiotIdInput = GuildIdInput.extend({
  riotId: RiotIdSchema,
  region: RegionSchema,
});
export type ResolveRiotIdInputData = z.infer<typeof ResolveRiotIdInput>;

export type ResolveRiotIdResult =
  | { kind: "ok"; puuid: string; gameName: string; tagLine: string }
  | { kind: "not-found"; message: string };

export async function resolveRiotIdExact(
  ctx: WebCtx,
  input: ResolveRiotIdInputData,
): Promise<ResolveRiotIdResult> {
  await assertAdmin(ctx, input.guildId);
  const result = await resolveRiotIdToPuuid(input.riotId, input.region);
  if (result.kind !== "ok") {
    return { kind: "not-found", message: result.message };
  }
  return {
    kind: "ok",
    puuid: result.puuid,
    gameName: input.riotId.game_name,
    tagLine: input.riotId.tag_line,
  };
}

export const SearchKnownAccountsInput = GuildIdInput.extend({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchKnownAccountsInputData = z.infer<
  typeof SearchKnownAccountsInput
>;

export async function searchKnownAccounts(
  ctx: WebCtx,
  input: SearchKnownAccountsInputData,
) {
  await assertAdmin(ctx, input.guildId);
  const accounts = await prisma.account.findMany({
    where: {
      serverId: input.guildId,
      OR: [
        { alias: { contains: input.query } },
        { riotGameName: { contains: input.query } },
      ],
    },
    include: { player: { select: { id: true, alias: true } } },
    orderBy: [{ alias: "asc" }, { id: "asc" }],
    take: input.limit,
  });
  return accounts.map((account) => ({
    accountId: account.id,
    alias: account.alias,
    region: account.region,
    riotGameName: account.riotGameName,
    riotTagLine: account.riotTagLine,
    player: account.player,
  }));
}
