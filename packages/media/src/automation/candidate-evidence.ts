import { Prisma } from "#generated/prisma/client.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { StoredCandidateSchema } from "./providers.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import type { ReleaseEvaluation } from "#domain/release-evaluation.ts";

function identity(attributes: ReleaseAttributes): string {
  return JSON.stringify({
    title: attributes.title,
    providerId: attributes.providerId,
    mediaIds: [...attributes.mediaIds].sort(),
    identityConfidence: attributes.identityConfidence,
    quality: attributes.quality,
    codec: attributes.codec,
    audioLanguages: [...attributes.audioLanguages].sort(),
    sizeBytes: attributes.sizeBytes,
    scoreTags: [...attributes.scoreTags].sort(),
  });
}
function sourceIdentity(source: ProviderCandidate): string {
  return JSON.stringify({
    providerId: source.providerId,
    providerReleaseId: source.providerReleaseId,
    title: source.title,
    sizeBytes: source.sizeBytes,
    infoHash: source.infoHash.toLowerCase(),
    download: source.download,
    ...(source.references === undefined
      ? {}
      : { references: source.references }),
    ...(source.editionEvidence === undefined
      ? {}
      : { editionEvidence: source.editionEvidence }),
  });
}
/** Source, metadata and evidence form one snapshot. FK claims serialize against this row lock. */
export async function persistCandidateSnapshot(
  context: MediaAutomationContext,
  input: {
    source: ProviderCandidate;
    attributes: ReleaseAttributes;
    evaluation: ReleaseEvaluation;
    searchedForMediaId?: string;
  },
): Promise<ReleaseAttributes | null> {
  const { source, attributes: next, evaluation } = input;
  if (
    source.title !== next.title ||
    source.sizeBytes !== next.sizeBytes ||
    source.providerId !== next.providerId
  )
    throw new Error("Candidate source and attributes disagree");
  const aad = `release:${source.providerId}:${source.providerReleaseId}`;
  return context.db.$transaction(async (tx) => {
    const found = await tx.releaseCandidate.upsert({
      where: {
        providerId_providerReleaseId: {
          providerId: source.providerId,
          providerReleaseId: source.providerReleaseId,
        },
      },
      create: {
        id: next.id,
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
        title: next.title,
        mediaIds: [...next.mediaIds],
        searchedForMediaIds:
          input.searchedForMediaId === undefined
            ? []
            : [input.searchedForMediaId],
        sourceEvidence: z.record(z.string(), z.json()).parse(
          CandidateSourceEvidenceSchema.parse({
            infoHash: source.infoHash.toLowerCase(),
            ...(source.references === undefined
              ? {}
              : { references: source.references }),
            ...(source.editionEvidence === undefined
              ? {}
              : { editionEvidence: source.editionEvidence }),
          }),
        ),
        attributes: PublicReleaseAttributesSchema.parse(next),
        evaluation,
        encryptedSource: context.cipher.encrypt(JSON.stringify(source), aad),
      },
      update: {},
    });
    const releaseId = found.id;
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM "ReleaseCandidate" WHERE id = ${releaseId} FOR UPDATE`,
    );
    const row = await tx.releaseCandidate.findUniqueOrThrow({
      where: { id: releaseId },
    });
    const current = {
      id: row.id,
      providerId: row.providerId,
      title: row.title,
      ...PublicReleaseAttributesSchema.parse(row.attributes),
    };
    if (row.encryptedSource === null) return null;
    const previousSource = StoredCandidateSchema.parse(
      JSON.parse(context.cipher.decrypt(row.encryptedSource, aad)),
    );
    if (
      identity(current) !== identity(next) ||
      sourceIdentity(previousSource) !== sourceIdentity(source)
    )
      return null;
    if ((await tx.acquisitionAttempt.count({ where: { releaseId } })) > 0)
      return current;
    const attributes = PublicReleaseAttributesSchema.parse(next);
    await tx.releaseCandidate.update({
      where: { id: releaseId },
      data: {
        attributes,
        evaluation,
        encryptedSource: context.cipher.encrypt(JSON.stringify(source), aad),
        searchedForMediaIds: [
          ...new Set([
            ...row.searchedForMediaIds,
            ...(input.searchedForMediaId === undefined
              ? []
              : [input.searchedForMediaId]),
          ]),
        ].slice(0, 100),
        sourceEvidence: z.record(z.string(), z.json()).parse(
          CandidateSourceEvidenceSchema.parse({
            infoHash: source.infoHash.toLowerCase(),
            ...(source.references === undefined
              ? {}
              : { references: source.references }),
            ...(source.editionEvidence === undefined
              ? {}
              : { editionEvidence: source.editionEvidence }),
          }),
        ),
      },
    });
    return { ...next, id: releaseId };
  });
}
