import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";

const Proof = z.object({
  id: z.string(),
  serverMachineId: z.string(),
  sectionId: z.string(),
  libraryRoot: z.string(),
  controlRoot: z.string(),
  rootMarkerSha256: z.string(),
  controlMarkerSha256: z.string(),
  configurationDigest: z.string(),
  evidence: z.json(),
  run: z.object({ state: z.string(), plan: z.json(), planDigest: z.string() }),
});
const Row = z.strictObject({ recoveryEpoch: z.int(), proof: Proof.nullable() });

/** One current database snapshot per check. No cache, retained permission or changed marker semantics. */
export async function currentPlexExclusionProof(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  roots: { library: string; control: string },
) {
  const rows = await db.$queryRaw`
    SELECT runtime."recoveryEpoch", selected.proof
    FROM "MediaRuntimeState" runtime
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', p.id, 'serverMachineId', p."serverMachineId", 'sectionId', p."sectionId",
        'libraryRoot', p."libraryRoot", 'controlRoot', p."controlRoot",
        'rootMarkerSha256', p."rootMarkerSha256", 'controlMarkerSha256', p."controlMarkerSha256",
        'configurationDigest', p."configurationDigest", 'evidence', p.evidence,
        'run', jsonb_build_object('state', r.state, 'plan', r.plan, 'planDigest', r."planDigest")
      ) AS proof
      FROM "PlexExclusionProof" p JOIN "PlexExclusionRun" r ON r.id=p."runId"
      WHERE p."libraryRoot"=${roots.library} AND p."controlRoot"=${roots.control}
        AND p."recoveryEpoch"=runtime."recoveryEpoch" AND p."revokedAt" IS NULL
      ORDER BY p."verifiedAt" DESC LIMIT 1
    ) selected ON true
    WHERE runtime.id='singleton'`;
  const [row] = z.tuple([Row]).parse(rows);
  return row;
}
