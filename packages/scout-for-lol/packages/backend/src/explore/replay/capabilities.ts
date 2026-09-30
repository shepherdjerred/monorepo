import { resolveBucksCapability } from "#src/explore/tools/bucks-tools.ts";
import { dareExploreEnabled } from "#src/explore/tools/dare-tool-context.ts";
import { challengeExploreEnabled } from "#src/explore/tools/challenge-tools.ts";
import { resolveCreationCapability } from "#src/explore/creation/capability.ts";
import { riotHistoryExploreEnabled } from "#src/explore/tools/riot-history-tools.ts";
import { resolveMvpVotesCapability } from "#src/explore/tools/mvp-votes-tools.ts";
import { clashExploreEnabled } from "#src/league/clash/access.ts";
import { resolveHallCapability } from "#src/explore/tools/hall-tools.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import type { ExploreCapabilitySet } from "#src/explore/replay/profiles.ts";

/**
 * What a turn with these inputs will actually be able to do.
 *
 * Calls the same resolvers `streamExploreAgent` calls, in the same order and
 * with the same arguments, rather than restating their rules. The agent
 * does not expose what it resolved, so a replay that wants to assert "this run
 * really was the `full` profile" has to ask the same questions a second time.
 *
 * That second call is only trustworthy because the harness pins flags
 * statically and reads one frozen database snapshot: nothing can change
 * between this call and the agent's. Against a live Flipt it would be a race,
 * which is one of the reasons the environment guard refuses to start without
 * static flags.
 */
export async function resolveReplayCapabilities(input: {
  readonly guildIds: readonly string[];
  readonly surface: ExploreSurface;
}): Promise<ExploreCapabilitySet> {
  const guildIds = [...input.guildIds];
  const bucks = await resolveBucksCapability(guildIds);
  const [dares, challenges, creation, riotHistory, mvpVotes, clash, hall] =
    await Promise.all([
      dareExploreEnabled(bucks),
      challengeExploreEnabled(guildIds),
      resolveCreationCapability({ surface: input.surface, guildIds }),
      riotHistoryExploreEnabled(guildIds),
      resolveMvpVotesCapability(guildIds),
      clashExploreEnabled(guildIds),
      resolveHallCapability(guildIds),
    ]);
  return {
    bucks: bucks !== null,
    dares,
    challenges,
    creation: creation !== null,
    riotHistory,
    mvpVotes: mvpVotes !== null,
    clash,
    hallOfFame: hall !== null,
  };
}
