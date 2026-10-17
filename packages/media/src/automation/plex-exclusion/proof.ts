import { z } from "zod";
import { constants, open } from "node:fs/promises";
import type { Database } from "#infrastructure/database.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import {
  PlexExclusionPlanSchema,
  PlexExclusionEvidenceSchema,
  PlexScanObservationSchema,
} from "#shared/plex-exclusion.ts";
import { safePath } from "#filesystem/operations-io.ts";
import {
  configurationDigest,
  digest,
  evaluateScan,
  textDigest,
} from "./evidence.ts";

const ProofEvidenceSchema = PlexExclusionEvidenceSchema.extend({
  filesCleanedAt: z.iso.datetime(),
  topologyCheckedAt: z.iso.datetime(),
  cleanup: z.object({
    state: z.literal("verified"),
    activityId: z.string().nullable(),
    requestedAt: z.iso.datetime(),
    first: PlexScanObservationSchema,
    second: PlexScanObservationSchema,
  }),
});

/** Read-only minute sweep attestation. A changed topology revokes, never silently re-proves exclusion. */
export async function refreshPlexExclusionProofs(
  db: Database,
  plex: PlexMaintenanceClient,
  config: { machineId: string; movieSectionId: string; tvSectionId: string },
): Promise<void> {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const proofs = await db.plexExclusionProof.findMany({
    where: { revokedAt: null, recoveryEpoch: runtime.recoveryEpoch },
    take: 100,
  });
  const cache = new Map<
    string,
    Awaited<ReturnType<PlexMaintenanceClient["topology"]>>
  >();
  for (const proof of proofs) {
    let topology = cache.get(proof.sectionId);
    if (topology === undefined) {
      topology = await plex.topology(proof.sectionId);
      cache.set(proof.sectionId, topology);
    }
    const matching =
      proof.serverMachineId === config.machineId &&
      topology.serverMachineId === config.machineId &&
      topology.sectionId ===
        (topology.kind === "movie"
          ? config.movieSectionId
          : config.tvSectionId) &&
      configurationDigest(topology) === proof.configurationDigest;
    if (!matching) {
      await db.plexExclusionProof.updateMany({
        where: { id: proof.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      continue;
    }
    const evidence = ProofEvidenceSchema.parse(proof.evidence);
    await db.plexExclusionProof.updateMany({
      where: {
        id: proof.id,
        revokedAt: null,
        recoveryEpoch: runtime.recoveryEpoch,
      },
      data: {
        evidence: { ...evidence, topologyCheckedAt: new Date().toISOString() },
      },
    });
  }
}

/** Files worker never trusts caller-supplied scannerExcluded booleans or old ApplicationEvents. */
export async function requirePlexExclusionProof(
  db: Database,
  roots: { library: string; control: string },
): Promise<void> {
  const proof = await requirePlexExclusionDatabaseProof(db, roots);
  if (
    (await markerHash(roots.library)) !== proof.rootMarkerSha256 ||
    (await markerHash(roots.control)) !== proof.controlMarkerSha256
  )
    throw new Error("Plex exclusion markers changed after proof");
}

/** API precondition only; files worker must also revalidate the actual marker bytes. */
export async function requirePlexExclusionDatabaseProof(
  db: Pick<
    Prisma.TransactionClient,
    "mediaRuntimeState" | "plexExclusionProof"
  >,
  roots: { library: string; control: string },
) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const proof = await db.plexExclusionProof.findFirst({
    where: {
      libraryRoot: roots.library,
      controlRoot: roots.control,
      recoveryEpoch: runtime.recoveryEpoch,
      revokedAt: null,
    },
    include: { run: true },
    orderBy: { verifiedAt: "desc" },
  });
  if (proof?.run.state !== "verified")
    throw new Error("Plex exclusion requires a completed scanner proof");
  const plan = PlexExclusionPlanSchema.parse(proof.run.plan);
  const evidence = ProofEvidenceSchema.parse(proof.evidence);
  const age = Date.now() - Date.parse(evidence.topologyCheckedAt);
  if (
    age < 0 ||
    age > 15 * 60_000 ||
    plan.recoveryEpoch !== runtime.recoveryEpoch ||
    digest(plan) !== proof.run.planDigest ||
    evidence.planDigest !== proof.run.planDigest ||
    configurationDigest(plan.topology) !== proof.configurationDigest ||
    plan.libraryRoot !== roots.library ||
    plan.controlRoot !== roots.control ||
    proof.rootMarkerSha256 !== evidence.rootMarkerSha256 ||
    proof.controlMarkerSha256 !== evidence.controlMarkerSha256
  )
    throw new Error("Plex exclusion proof is stale or mismatched");
  if (
    evaluateScan({
      plan,
      stagedAt: evidence.stagedAt,
      activityId: evidence.activityId,
      first: evidence.first,
      second: evidence.second,
    }).state !== "verified" ||
    evaluateScan({
      plan,
      stagedAt: evidence.filesCleanedAt,
      activityId: evidence.cleanup.activityId,
      first: evidence.cleanup.first,
      second: evidence.cleanup.second,
      cleanup: true,
    }).state !== "verified"
  )
    throw new Error("Plex scanner evidence is incomplete");
  return proof;
}

async function markerHash(root: string): Promise<string> {
  const path = await safePath(root, ".plexignore", false);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024)
      throw new Error("Invalid Plex exclusion marker");
    return textDigest(await handle.readFile());
  } finally {
    await handle.close();
  }
}
