import type { ScoutPostMatchDiscoveryOwnerV2Result } from "@scout-for-lol/temporal/activity-contracts-v2";
import { IsoInstantSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { readHeldPostMatchPoll } from "#src/league/tasks/recovery/app-state.ts";

/**
 * Decide which pipeline owns one post-match discovery pass.
 *
 * `scout_v2_postmatch_ownership_enabled` answers first, per environment, and
 * is on by default: V2 keeps discovery unless an operator turns it off.
 *
 * When it is off, v1 may run only once no live poll holds `BotState`. v1's
 * discovery opens its poll unconditionally instead of claiming it, so
 * starting it while a V2 run still holds its durable claim would rediscover
 * the matches that run is still processing and let two pipelines apply the
 * same match. Deferring costs one tick. The staleness bound still frees a
 * poll that a terminated run left behind.
 */
export async function resolvePostMatchDiscoveryOwnerV2(input: {
  now: Date;
}): Promise<ScoutPostMatchDiscoveryOwnerV2Result> {
  if (await isPolicyEnabled("scout_v2_postmatch_ownership_enabled")) {
    return { decision: "run-v2" };
  }
  const held = await readHeldPostMatchPoll(input.now);
  if (held === null) return { decision: "delegate-v1" };
  return {
    decision: "defer-v1",
    pollHeldSince: IsoInstantSchema.parse(held.toISOString()),
  };
}
