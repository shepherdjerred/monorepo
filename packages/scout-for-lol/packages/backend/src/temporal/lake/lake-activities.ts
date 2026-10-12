import type { ScoutLakeActivities } from "#src/temporal/durable-activity-surface.ts";
import { heartbeatWhile } from "#src/temporal/activity-runtime.ts";

/**
 * The V2 lake Activity, as the Activity Worker sees it.
 *
 * One member, and it needs its own group because the queue is the point.
 * `stageLakeProjection` is the only V2 Activity assigned to `lake`, and that
 * queue is served by exactly the roles that own the report lake's volume — so
 * routing the projection here is what keeps a role that merely polls Riot from
 * writing staging files onto a volume another role is publishing builds from.
 *
 * The implementation is dynamically imported for the same reason every other
 * V2 group does it: the activity groups are built during startup for every role
 * that polls any queue, and the DuckDB and Riot slices behind this one have no
 * business loading into a process that will never stage a projection.
 */
export function createScoutLakeActivities(): ScoutLakeActivities {
  return {
    stageLakeProjection: async (input) =>
      await heartbeatWhile(
        { riotMatchId: input.riotMatchId, phase: "staging-lake-projection-v2" },
        async () => {
          const { stageLakeProjection } =
            await import("#src/temporal/lake/lake-projection.ts");
          return await stageLakeProjection(input);
        },
      ),
  };
}
