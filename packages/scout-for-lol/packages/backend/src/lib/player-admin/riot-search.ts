/**
 * Exact Riot ID → PUUID/canonical-name lookup, used to confirm a typed/picked
 * Riot ID before committing a subscription/account. Riot's Account API only
 * supports exact match, so there is no server-side fuzzy search against Riot
 * itself — partial-name suggestions come from `summoner-search.ts` instead.
 */

import type { z } from "zod";
import { RegionSchema, RiotIdSchema } from "@scout-for-lol/data";
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
  // Use Riot's canonical casing (surfaced by resolveRiotIdToPuuid) rather than
  // the user-typed input, so the displayed/stored Riot ID matches Riot.
  return {
    kind: "ok",
    puuid: result.puuid,
    gameName: result.gameName,
    tagLine: result.tagLine,
  };
}
