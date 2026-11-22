import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { buildStatus } from "./status.ts";

const CarriedRowsSchema = z.array(
  z.object({
    buildId: z.string(),
    includedIn: z.string(),
    includedInPosition: z.number().int(),
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
export type Carrier = {
  includedIn: string;
  /** The carrying commit's place on main: its push pipeline's number. */
  includedInPosition: number;
  releaseBuildId: string | null;
};

/**
 * The first passing CI build of `f`'s service, later on main than `f.position`
 * and of another commit, that has a release (a composed set or a platform
 * deployment). `f` names a build's "serviceId", "sourceRevision" and
 * position.
 */
const RELEASED_AFTER = Prisma.sql`
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
`;

const SupersededRowsSchema = z.array(
  z.object({ buildId: z.string(), releaseBuildId: z.string() }),
);

/**
 * For each passing CI build that built new artifacts yet has no release,
 * because a newer verified build of its service already stood for it when it
 * was qualified, the first later passing build of the service with a
 * release, which carries its change. A build that only kept earlier
 * artifacts changed nothing and has none.
 */
export async function supersedingReleases(
  database: Database,
  buildIds: string[],
): Promise<Map<string, string>> {
  if (buildIds.length === 0) return new Map();
  const rows = SupersededRowsSchema.parse(
    await database.$queryRaw`
    WITH superseded AS (
      SELECT c.id, c."serviceId", c."sourceRevision",
        COALESCE(cs."pipelineNumber", c."pipelineNumber") AS position
      FROM "Build" c
      LEFT JOIN "SourceCommit" cs ON cs."sourceRevision" = c."sourceRevision"
      WHERE c.id = ANY(${buildIds}) AND c."sourceKind" = 'ci'
        AND c.status = 'verified' AND c."pipelineNumber" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "Artifact" a WHERE a."buildId" = c.id)
        AND NOT EXISTS (SELECT 1 FROM "VersionSet" v WHERE v."qualifiedBuildId" = c.id)
        AND NOT EXISTS (SELECT 1 FROM "Deployment" d
          WHERE d."platformSourceBuildId" = c.id)
    )
    SELECT f.id AS "buildId", released.id AS "releaseBuildId"
    FROM superseded f
    CROSS JOIN LATERAL (${RELEASED_AFTER}) released
  `,
  );
  return new Map(rows.map((row) => [row.buildId, row.releaseBuildId]));
}

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
      first.position AS "includedInPosition", released.id AS "releaseBuildId"
    FROM failed f
    CROSS JOIN LATERAL (
      SELECT b.id, b."sourceRevision",
        COALESCE(bs."pipelineNumber", b."pipelineNumber") AS position
      FROM "Build" b
      LEFT JOIN "SourceCommit" bs ON bs."sourceRevision" = b."sourceRevision"
      WHERE b."serviceId" = f."serviceId" AND b."sourceKind" = 'ci'
        AND b.status = 'verified' AND b."sourceRevision" <> f."sourceRevision"
        AND COALESCE(bs."pipelineNumber", b."pipelineNumber") > f.position
      ORDER BY COALESCE(bs."pipelineNumber", b."pipelineNumber"), b.id
      LIMIT 1
    ) first
    LEFT JOIN LATERAL (${RELEASED_AFTER}) released ON true
  `,
  );
  return new Map(
    rows.map((row) => [
      row.buildId,
      {
        includedIn: row.includedIn,
        includedInPosition: row.includedInPosition,
        releaseBuildId: row.releaseBuildId,
      },
    ]),
  );
}

/**
 * For each commit whose every build failed, the first later commit that
 * carries one of its failed builds. Such a commit's pipeline failed as a
 * whole, so CI published few or none of the services it changed. CI chooses
 * what to build against the last whole successful pipeline, so the first
 * later commit whose pipeline passed built everything this one changed: its
 * releases are the ones that carry this commit's change.
 */
export function pipelineCarriers(
  shas: readonly string[],
  builds: readonly { id: string; sourceRevision: string; status: string }[],
  carried: ReadonlyMap<string, Carrier>,
) {
  const carriers = new Map<string, string>();
  for (const sha of shas) {
    const own = builds.filter((row) => row.sourceRevision === sha);
    if (
      own.length === 0 ||
      own.some((row) => buildStatus(row.status) !== "failed")
    )
      continue;
    const [first] = own
      .flatMap((row) => {
        const carrier = carried.get(row.id);
        return carrier === undefined ? [] : [carrier];
      })
      .toSorted(
        (left, right) => left.includedInPosition - right.includedInPosition,
      );
    if (first !== undefined) carriers.set(sha, first.includedIn);
  }
  return carriers;
}
