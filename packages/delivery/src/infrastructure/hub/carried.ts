import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";

const CarriedRowsSchema = z.array(
  z.object({
    buildId: z.string(),
    includedIn: z.string(),
    releaseBuildId: z.string().nullable(),
  }),
);

/**
 * The later commit that carries a failed build's change, and the first
 * later passing build of the service with a release (a composed set or a
 * platform deployment), which is the release the change ships in. A passing
 * build composes nothing when a newer verified build of the service already
 * stands for it, so the two can differ; `releaseBuildId` is null while no
 * later passing build has a release yet.
 */
export type Carrier = { includedIn: string; releaseBuildId: string | null };

/**
 * For each failed CI build, by failed build id, the first later main commit
 * whose build of the same service passed, and the first such build with a
 * release. Main is linear, so a commit pushed after another descends from
 * it: that commit's tree includes the failed one's change. A commit's place
 * on main is its push pipeline, the one its source record was read from
 * (else its build's own), so a rerun of an older commit never counts as
 * later.
 */
export async function carryingCommits(
  database: Database,
  failedIds: string[],
): Promise<Map<string, Carrier>> {
  if (failedIds.length === 0) return new Map();
  const rows = CarriedRowsSchema.parse(
    await database.$queryRaw`
    WITH failed AS (
      SELECT f.id, f."serviceId", f."sourceRevision",
        COALESCE(fs."pipelineNumber", f."pipelineNumber") AS position
      FROM "Build" f
      LEFT JOIN "SourceCommit" fs ON fs."sourceRevision" = f."sourceRevision"
      WHERE f.id = ANY(${failedIds}) AND f."sourceKind" = 'ci'
        AND f.status = 'failed' AND f."pipelineNumber" IS NOT NULL
    )
    SELECT f.id AS "buildId", first."sourceRevision" AS "includedIn",
      released.id AS "releaseBuildId"
    FROM failed f
    CROSS JOIN LATERAL (
      SELECT b.id, b."sourceRevision" FROM "Build" b
      LEFT JOIN "SourceCommit" bs ON bs."sourceRevision" = b."sourceRevision"
      WHERE b."serviceId" = f."serviceId" AND b."sourceKind" = 'ci'
        AND b.status = 'verified' AND b."sourceRevision" <> f."sourceRevision"
        AND COALESCE(bs."pipelineNumber", b."pipelineNumber") > f.position
      ORDER BY COALESCE(bs."pipelineNumber", b."pipelineNumber"), b.id
      LIMIT 1
    ) first
    LEFT JOIN LATERAL (
      SELECT b.id FROM "Build" b
      LEFT JOIN "SourceCommit" bs ON bs."sourceRevision" = b."sourceRevision"
      WHERE b."serviceId" = f."serviceId" AND b."sourceKind" = 'ci'
        AND b.status = 'verified' AND b."sourceRevision" <> f."sourceRevision"
        AND COALESCE(bs."pipelineNumber", b."pipelineNumber") > f.position
        AND (EXISTS (SELECT 1 FROM "VersionSet" v WHERE v."qualifiedBuildId" = b.id)
          OR EXISTS (SELECT 1 FROM "Deployment" d
            WHERE d."platformSourceBuildId" = b.id))
      ORDER BY COALESCE(bs."pipelineNumber", b."pipelineNumber"), b.id
      LIMIT 1
    ) released ON true
  `,
  );
  return new Map(
    rows.map((row) => [
      row.buildId,
      { includedIn: row.includedIn, releaseBuildId: row.releaseBuildId },
    ]),
  );
}
