import { defaultIntent } from "#shared/editions/scope.ts";
import { previewDefaultEdition } from "#infrastructure/editions/acquisition.ts";
import {
  coordinateBlockers,
  referenceConflict,
  previewQuality,
} from "./evaluation.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  CandidateSourceEvidenceSchema,
  type AcquisitionIdentitySnapshot,
} from "#shared/acquisition/identity.ts";
import {
  IdentityPreviewSchema,
  type IdentityPreviewInput,
} from "#shared/acquisition/preview.ts";
import {
  buildCanonicalIdentity,
  candidateDigest,
  identityHash,
} from "./snapshot.ts";
import { authorizeRenewal } from "#infrastructure/action-guards.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";

export async function buildIdentityPreview(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: IdentityPreviewInput & {
    mediaId: string;
    releaseId: string;
    serverMachineId?: string;
  },
) {
  const ids = [...input.mediaIds].sort();
  if (!ids.includes(input.mediaId))
    throw new MediaError(
      "identity_target_missing",
      "Selected coverage must include the requested title",
      422,
    );
  for (const mediaId of ids)
    await authorizeRenewal(tx, actor, {
      mediaId,
      action: "select_release",
      ...(input.serverMachineId === undefined
        ? {}
        : { serverMachineId: input.serverMachineId }),
    });
  await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${input.releaseId} FOR SHARE`;
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  if (
    !release.mediaIds.includes(input.mediaId) &&
    !release.searchedForMediaIds.includes(input.mediaId)
  )
    throw new MediaError(
      "invalid_release",
      "Release was not discovered for this title",
      422,
    );
  if (release.sourceEvidence === null)
    throw new MediaError(
      "identity_source_missing",
      "Search again to capture source identity evidence",
      409,
    );
  const source = CandidateSourceEvidenceSchema.parse(release.sourceEvidence);
  const canonical = await buildCanonicalIdentity(tx, ids);
  const rootId =
    canonical.kind === "movie"
      ? canonical.mediaId
      : canonical.coordinates.seriesId;
  const root = await tx.mediaItem.findUniqueOrThrow({ where: { id: rootId } });
  const identityReasons = await coordinateBlockers(
    tx,
    canonical,
    release.title,
    ids,
  );
  if (referenceConflict(root, source.references ?? []))
    identityReasons.push("external_identity_conflict");
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const sponsor = await tx.mediaRequest.findFirst({
    where: { mediaId: input.mediaId, ...effectiveRequestWhere },
    orderBy: { createdAt: "asc" },
  });
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: {
      intents: { where: { edition: "default" }, include: { profile: true } },
    },
    orderBy: { id: "asc" },
  });
  const proposed: AcquisitionIdentitySnapshot = {
    schemaVersion: 1,
    source: {
      releaseId: release.id,
      candidateDigest: candidateDigest(release),
    },
    proof: {
      kind: "automatic",
      basis: "title_year",
      references: [],
      evidenceHash: identityHash(canonical),
    },
    canonical,
    coverage: ids,
    sponsorRequestId: sponsor?.id ?? actor.id,
    sponsorAuthority: {
      userId: sponsor?.userId ?? actor.id,
      actorId: actor.id,
      serverMachineId: z.string().min(1).parse(input.serverMachineId),
    },
    birthEpoch: runtime.recoveryEpoch,
  };
  const blockers = previewQuality(rows, input.mediaId, release, proposed);
  const edition = await previewDefaultEdition(tx, {
    releaseId: release.id,
    mediaIds: ids,
  });
  if (sponsor === null) blockers.add("request_required");
  const unsigned = {
    schemaVersion: 1 as const,
    releaseId: release.id,
    candidateDigest: proposed.source.candidateDigest,
    providerId: release.providerId,
    title: release.title,
    identityReasons,
    references: source.references ?? [],
    canonical,
    canonicalTitle: root.title,
    canonicalYear: root.year,
    media: rows.map((row) => ({
      id: row.id,
      title: row.title,
      year: row.year,
      version: row.version,
      generation: defaultIntent(row.intents)?.generation ?? 0,
    })),
    sponsorRequestId: sponsor?.id ?? null,
    numberingDigest:
      canonical.kind === "series" ? canonical.coordinates.digest : null,
    qualityBlockers: [...blockers].sort(),
    edition,
    confirmationAllowed: permitsConfirmation(
      identityReasons,
      blockers,
      edition.accepted,
    ),
  };
  const mapping = await tx.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: actor.id },
  });
  const currentActor = await tx.mediaUser.findUniqueOrThrow({
    where: { id: actor.id },
  });
  return IdentityPreviewSchema.parse({
    ...unsigned,
    previewDigest: identityHash({
      ...unsigned,
      epoch: runtime.recoveryEpoch,
      actorVersion: currentActor.version,
      mappingVersion: mapping.version,
    }),
  });
}
function permitsConfirmation(
  identityReasons: readonly string[],
  qualityBlockers: ReadonlySet<string>,
  editionAccepted: boolean,
): boolean {
  return (
    editionAccepted &&
    identityReasons.length === 0 &&
    qualityBlockers.size === 0
  );
}
import { z } from "zod";
