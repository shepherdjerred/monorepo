import type { Prisma } from "#generated/prisma/client.ts";
import {
  RecoveryClaimProjectionSchema,
  type RecoveryClaimProjection,
} from "#shared/recovery-claims.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  bindingIdentity,
  durableBindingIdentity,
  requesterEvidence,
} from "./bindings.ts";
import { accountedRecoveryClaims, claimIdentityHash } from "./accounting.ts";
import { projectLegacyCoordinates } from "./coordinates.ts";
import { unresolvedRecoveryClaims } from "#infrastructure/recovery/provenance.ts";
import { parseStoredClaim, relevantRecordWhere } from "./records.ts";

export async function buildRecoveryClaims(
  db: Prisma.TransactionClient,
  input: { planIds: string[]; mediaIds: string[] },
) {
  const media = await db.mediaItem.findMany({
    where: { id: { in: input.mediaIds } },
    include: { parent: { include: { parent: true } } },
  });
  const records = await db.migrationRecord.findMany({
    where: relevantRecordWhere(media),
    include: { capture: true },
    orderBy: [{ captureId: "asc" }, { provenanceKey: "asc" }],
    take: 1001,
  });
  if (records.length > 1000)
    return {
      claims: [],
      blockers: ["legacy_claim_history_exceeds_bound"],
      relevantClaims: [],
    };
  const accounted = await accountedRecoveryClaims(db, input.mediaIds);
  const claims: RecoveryClaimProjection[] = [];
  const blockers = new Set<string>();
  const relevantClaims: { userId: string; mediaIds: string[] }[] = [];
  for (const stored of records) {
    const record = parseStoredClaim(stored);
    if (record.kind !== "request" || !record.active) continue;
    const projected = await projectLegacyCoordinates(db, record, media);
    if (!projected.relevant) continue;
    if (!stored.capture.complete || !stored.capture.stable) {
      blockers.add("legacy_claim_capture_incomplete");
      continue;
    }
    if (projected.reason !== null) {
      blockers.add(projected.reason);
      continue;
    }
    const binding = await db.legacyRequesterBinding.findFirst({
      where: {
        captureId: stored.captureId,
        sourceKind: stored.capture.sourceKind,
        sourceInstanceId: stored.capture.sourceInstanceId,
        requesterSourceId: record.requesterSourceId,
      },
      orderBy: { revision: "desc" },
      include: { user: { include: { plexIdentity: true } } },
    });
    if (binding === null) {
      blockers.add("legacy_claim_requester_unmapped");
      continue;
    }
    relevantClaims.push({
      userId: binding.userId,
      mediaIds: projected.mediaIds,
    });
    const evidence = await requesterEvidence(
      db,
      stored.captureId,
      record.requesterSourceId,
    );
    if (
      binding.captureHash !== stored.capture.manifestHash ||
      evidence.requesterEvidenceHash !== binding.requesterEvidenceHash ||
      binding.user.plexIdentity === null ||
      snapshotHash(durableBindingIdentity(bindingIdentity(binding.user))) !==
        snapshotHash(durableBindingIdentity(binding.identitySnapshot))
    ) {
      blockers.add("legacy_claim_binding_identity_changed");
      continue;
    }
    const latest = await db.legacyRequesterBinding.findFirstOrThrow({
      where: {
        sourceKind: binding.sourceKind,
        sourceInstanceId: binding.sourceInstanceId,
        requesterSourceId: binding.requesterSourceId,
      },
      orderBy: { revision: "desc" },
    });
    const claim = RecoveryClaimProjectionSchema.parse({
      captureId: stored.captureId,
      captureHash: stored.capture.manifestHash,
      sourceKind: stored.capture.sourceKind,
      sourceInstanceId: stored.capture.sourceInstanceId,
      provenanceKey: stored.provenanceKey,
      recordDigest: stored.observationHash,
      requesterSourceId: record.requesterSourceId,
      bindingId: binding.id,
      bindingRevision: binding.revision,
      latestBindingRevision: latest.revision,
      userId: binding.userId,
      mediaIds: projected.mediaIds,
      outsideMediaIds: projected.outsideMediaIds,
      sourceScope: record.scope,
      seasons: record.seasons,
    });
    appendUnaccounted(claims, accounted, claim);
  }
  // Original applied handoff reports remain authoritative even if an old import
  // did not persist requester records. Never dismiss missing capture evidence.
  if (
    await unresolvedRecoveryClaims(db, {
      ...input,
      evaluatedRecords: records.map((row) => ({
        captureHash: row.capture.manifestHash,
        provenanceKey: row.provenanceKey,
        recordDigest: row.observationHash,
      })),
    })
  )
    blockers.add("unresolved_migration_household_claim");
  return { claims, blockers: [...blockers].sort(), relevantClaims };
}

function appendUnaccounted(
  claims: RecoveryClaimProjection[],
  accounted: Map<string, Set<string>>,
  claim: RecoveryClaimProjection,
) {
  const prior = accounted.get(claimIdentityHash(claim));
  const remaining = claim.mediaIds.filter((id) => prior?.has(id) !== true);
  if (remaining.length > 0) claims.push({ ...claim, mediaIds: remaining });
}
