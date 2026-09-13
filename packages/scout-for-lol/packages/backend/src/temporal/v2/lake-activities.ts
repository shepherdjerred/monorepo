import type { ScoutTemporalV2Activities } from "@scout-for-lol/temporal/activities";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The V2 lake Activity, as the Activity Worker sees it.
 *
 * One member, and it needs its own group because the queue is the point.
 * `stageLakeProjectionV2` is the only V2 Activity assigned to `lake`, and that
 * queue is served by exactly the roles that own the report lake's volume — so
 * routing the projection here is what keeps a role that merely polls Riot from
 * writing staging files onto a volume another role is publishing builds from.
 *
 * The implementation is dynamically imported for the same reason every other
 * V2 group does it: the activity groups are built during startup for every role
 * that polls any queue, and the DuckDB and Riot slices behind this one have no
 * business loading into a process that will never stage a projection.
 */
export type ScoutV2LakeActivities = Pick<
  ScoutTemporalV2Activities,
  "stageLakeProjectionV2"
>;

export function createScoutV2LakeActivities(): ScoutV2LakeActivities {
  return {
    stageLakeProjectionV2: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "staging-lake-projection-v2" },
        async () => {
          const { stageLakeProjectionV2 } =
            await import("#src/temporal/v2/lake-projection.ts");
          return await stageLakeProjectionV2(input);
        },
      ),
  };
}
