import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";

const CarriedRowsSchema = z.array(
  z.object({
    buildId: z.string(),
    includedIn: z.string(),
    carrierBuildId: z.string(),
  }),
);

/** The later commit that carries a failed build's change, and its passing build. */
export type Carrier = { includedIn: string; carrierBuildId: string };

/**
 * For each failed CI build, the first later main commit whose build of the
 * same service passed, and that passing build, by failed build id. Main is
 * linear, so a commit pushed after another descends from it: that commit's
 * tree includes the failed one's change, and its passing build published it.
 * A commit's place on main is its push pipeline, the one its source record
 * was read from (else its build's own), so a rerun of an older commit never
 * counts as later.
 */
export async function carryingCommits(
  database: Database,
  failedIds: string[],
): Promise<Map<string, Carrier>> {
  if (failedIds.length === 0) return new Map();
  const rows = CarriedRowsSchema.parse(
    await database.$queryRaw`
    SELECT f.id AS "buildId", c."sourceRevision" AS "includedIn",
      c.id AS "carrierBuildId"
    FROM "Build" f
    LEFT JOIN "SourceCommit" fs ON fs."sourceRevision" = f."sourceRevision"
    CROSS JOIN LATERAL (
      SELECT b.id, b."sourceRevision" FROM "Build" b
      LEFT JOIN "SourceCommit" bs ON bs."sourceRevision" = b."sourceRevision"
      WHERE b."serviceId" = f."serviceId" AND b."sourceKind" = 'ci'
        AND b.status = 'verified' AND b."sourceRevision" <> f."sourceRevision"
        AND COALESCE(bs."pipelineNumber", b."pipelineNumber")
          > COALESCE(fs."pipelineNumber", f."pipelineNumber")
      ORDER BY COALESCE(bs."pipelineNumber", b."pipelineNumber"), b.id
      LIMIT 1
    ) c
    WHERE f.id = ANY(${failedIds}) AND f."sourceKind" = 'ci'
      AND f.status = 'failed' AND f."pipelineNumber" IS NOT NULL
  `,
  );
  return new Map(
    rows.map((row) => [
      row.buildId,
      { includedIn: row.includedIn, carrierBuildId: row.carrierBuildId },
    ]),
  );
}
