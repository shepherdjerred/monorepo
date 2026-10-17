import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { parseCutEvidence } from "#domain/editions/parse.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import type {
  CutMember,
  CutCanonical,
  DefaultEditionDecision,
} from "#shared/editions/evidence.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { cutCanonical, currentCuts, releaseCut } from "./cut-context.ts";

export type DefaultAcquisitionEditionInput = {
  releaseId: string;
  mediaIds: readonly string[];
  members?: readonly CutMember[];
  predecessorAssetIds?: readonly string[];
};

/** Read-only projection; callers retain the existing canonical/target locks for effects. */
export async function previewDefaultEdition(
  tx: Prisma.TransactionClient,
  input: DefaultAcquisitionEditionInput,
): Promise<DefaultEditionDecision> {
  const canonical = await cutCanonical(tx, input.mediaIds);
  return assessDefaultEdition(tx, input, canonical);
}

async function assessDefaultEdition(
  tx: Prisma.TransactionClient,
  input: DefaultAcquisitionEditionInput,
  canonical: CutCanonical,
): Promise<DefaultEditionDecision> {
  const release = await tx.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  return evaluateDefaultCut({
    candidate: releaseCut(release, canonical),
    current: await currentCuts(tx, canonical, input),
    members: (input.members ?? []).map((member) =>
      parseCutEvidence({
        source:
          member.kind === "torrent_member"
            ? {
                kind: "member",
                attemptId: member.attemptId,
                torrentFileIndex: member.torrentFileIndex,
              }
            : {
                kind: "legacy_member",
                attemptId: member.attemptId,
                operationId: member.operationId,
              },
        sourceDigest: identityHash(member),
        canonical,
        attribution: "torrent_member",
        texts: [
          {
            text: member.relativePath,
            provenance: {
              kind: "release-title",
              field: "original.relativePath",
            },
          },
        ],
      }),
    ),
  });
}

/** Does not create targets, renew demand, or reinterpret persisted evidence. */
export async function assertDefaultAcquisitionEdition(
  tx: Prisma.TransactionClient,
  input: DefaultAcquisitionEditionInput,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "ReleaseCandidate" WHERE id = ${input.releaseId} FOR SHARE`;
  const canonical = await cutCanonical(tx, input.mediaIds);
  const definition = await tx.mediaEditionDefinition.findUniqueOrThrow({
    where: {
      rootMediaId_key: { rootMediaId: canonical.rootMediaId, key: "default" },
    },
  });
  z.object({
    rootMediaId: z.literal(canonical.rootMediaId),
    key: z.literal("default"),
    policy: z.literal("standard_unmarked"),
    definitionVersion: z.int().nonnegative(),
    pathLabel: z.literal(""),
    plexLabel: z.literal(""),
  }).parse(definition);
  const targets = await tx.mediaIntent.findMany({
    where: { mediaId: { in: [...input.mediaIds] }, edition: "default" },
  });
  if (targets.some((target) => target.editionRootId !== canonical.rootMediaId))
    throw new MediaError(
      "lineage_unresolved",
      "Default cut target lineage needs reconciliation",
      409,
    );
  const decision = await assessDefaultEdition(tx, input, canonical);
  if (!decision.accepted)
    throw new MediaError(
      decision.reasons[0] ?? "edition_evidence_ambiguous",
      "The default target cannot acquire or replace this cut",
      409,
    );
}
