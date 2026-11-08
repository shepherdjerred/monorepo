import { z } from "zod";
import type { Prisma, ReleaseCandidate } from "#generated/prisma/client.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import {
  candidateDigest,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import type { LibraryManagementInvocation } from "#infrastructure/acquisition-identity/library-policy.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  SeriesPackInterpretationEnvelopeV1Schema,
  SeriesPackInterpretationV1Schema,
  type SeriesPackInterpretationV1,
} from "#shared/acquisition/series-pack-v1.ts";
import { seriesPackCatalogV1, seriesPackChanged } from "./catalog.ts";
import {
  readSeriesPackInterpretationV1,
  seriesPackInterpretationKeyV1,
} from "./parent.ts";

/** The complete actual catalog and original provider snapshot are locked before this new assessment is recorded. */
export async function appendSeriesPackInterpretationV1(
  tx: Prisma.TransactionClient,
  input: { value: SeriesPackInterpretationV1; primaryMediaId: string },
  invocation: LibraryManagementInvocation,
) {
  invocation.freshness.assertActive();
  const proposed = SeriesPackInterpretationV1Schema.parse(input.value);
  await lockAcquisitionMedia(tx, proposed.attributes.mediaIds);
  await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id=${proposed.releaseId} FOR UPDATE`;
  const source = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: proposed.releaseId },
  });
  invocation.budget.consume(1);
  const current = await seriesPackCatalogV1(
    tx,
    { primaryMediaId: input.primaryMediaId, range: proposed.range },
    invocation.budget,
  );
  if (
    candidateDigest(source) !== proposed.sourceHash ||
    current.canonicalHash !== proposed.canonicalHash ||
    identityHash(current.profile) !== identityHash(proposed.profile)
  )
    throw seriesPackChanged(
      "Pack source, whole catalog or actual profile changed before assessment",
    );
  const key = seriesPackInterpretationKeyV1(proposed);
  const prior = await tx.operation.findUnique({
    where: { idempotencyKey: key },
  });
  invocation.budget.consume(prior === null ? 0 : 1);
  if (prior !== null) return readSeriesPackInterpretationV1(prior);
  const value = SeriesPackInterpretationV1Schema.parse({
    ...proposed,
    canonical: current.canonical,
  });
  const envelope = SeriesPackInterpretationEnvelopeV1Schema.parse({
    schemaVersion: 1,
    kind: "assess_series_pack_v1",
    interpretation: value,
    interpretationHash: identityHash(value),
    raw: canonicalJson(z.json().parse(value)),
    sourceRaw: seriesPackSourceRawV1(source),
    profileRaw: canonicalJson(z.json().parse(current.profileRules)),
  });
  if (
    [envelope.raw, envelope.sourceRaw, envelope.profileRaw].some(
      (raw) => Buffer.byteLength(raw, "utf8") > 131_072,
    )
  )
    throw seriesPackChanged("Pack immutable evidence exceeds its byte bound");
  await bindPlexTransactionDeadline(tx, invocation.freshness);
  await tx.operation.createMany({
    data: [
      {
        id: crypto.randomUUID(),
        idempotencyKey: key,
        kind: "assess_series_pack_v1",
        targetId: value.seriesId,
        userId: null,
        status: "completed",
        payload: z.record(z.string(), z.json()).parse(envelope),
      },
    ],
    skipDuplicates: true,
  });
  const stored = await tx.operation.findUniqueOrThrow({
    where: { idempotencyKey: key },
  });
  invocation.budget.consume(1);
  invocation.freshness.assertActive();
  return readSeriesPackInterpretationV1(stored);
}

/** The existing canonical serializer supplies the exact original candidateDigest input, never a rewritten source. */
function seriesPackSourceRawV1(source: ReleaseCandidate) {
  return canonicalJson(
    z.json().parse({
      providerId: source.providerId,
      providerReleaseId: source.providerReleaseId,
      title: source.title,
      attributes: source.attributes,
      source: CandidateSourceEvidenceSchema.parse(source.sourceEvidence),
    }),
  );
}
