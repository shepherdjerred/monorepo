import { z } from "zod";
import type { MediaIntent, Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import {
  readLibraryHandoffReceipt,
  type LibraryHandoffReceipt,
} from "#infrastructure/handoff/library-receipt.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import {
  lockMovieChoiceIdentities,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import {
  LibraryMovieManagementAuthoritySchema,
  type LibraryMovieManagementAuthority,
} from "#shared/movie-editions/management/contracts.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";

import type { MovieManagementInvocation } from "./invocation.ts";
type ManagementInput = {
  scope: MovieEditionScope;
  epoch: number;
  access: MovieChoiceAccess;
  expected?: LibraryMovieManagementAuthority;
};
const hash = (value: unknown) => identityHash(nativeJson(value));
function protectedManagement(): never {
  throw new MediaError(
    "library_management_unconfirmed",
    "Existing-library management needs its current owner-approved policy",
    409,
  );
}

/** Caller holds canonical/target/claim/runtime locks. Every receipt read uses the caller's one allowance. */
export async function readLibraryMovieManagement(
  tx: Prisma.TransactionClient,
  input: ManagementInput,
  invocation: MovieManagementInvocation,
) {
  invocation.execution.assertActive();
  const candidates =
    input.expected === undefined
      ? await tx.mediaHandoffReceipt.findMany({
          where: {
            recoveryEpoch: input.epoch,
            selection: {
              path: ["scope", "targets"],
              array_contains: [
                { mediaId: input.scope.mediaId, edition: input.scope.edition },
              ],
            },
          },
          orderBy: { id: "asc" },
          take: 2,
          select: { id: true },
        })
      : [{ id: input.expected.receiptId }];
  if (input.expected === undefined)
    invocation.budget.consume(candidates.length);
  if (input.expected === undefined && candidates.length === 0) return null;
  const candidate = candidates[0];
  if (candidate === undefined || candidates.length !== 1) protectedManagement();
  const original = await readLibraryHandoffReceipt(
    tx,
    candidate.id,
    invocation.budget,
  );
  const { receipt, selection } = original;
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.scope.mediaId,
        edition: input.scope.edition,
      },
    },
  });
  const policy = managementPolicy(original, target, input);
  await lockMovieChoiceIdentities(tx, {
    mediaIds: [input.scope.mediaId],
    extraUserIds: [receipt.actorId],
  });
  const owner = await tx.mediaUser.findUniqueOrThrow({
    where: { id: receipt.actorId },
  });
  invocation.budget.consume(1);
  if (owner.role !== "owner" || owner.restricted) protectedManagement();
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: policy.profileId },
  });
  const binding = await managementBinding(tx, input, invocation);
  const proof = LibraryMovieManagementAuthoritySchema.parse({
    schemaVersion: 2,
    kind: "library_management",
    ...input.scope,
    receiptId: receipt.id,
    planId: receipt.planId,
    planHash: receipt.planHash,
    selectionHash: hash({
      targets: selection.scope.targets.filter(
        (item) =>
          item.mediaId === input.scope.mediaId &&
          item.edition === input.scope.edition,
      ),
      media: policy,
    }),
    actorId: receipt.actorId,
    serverMachineId: input.access.serverMachineId,
    sectionId: input.access.movieSectionId,
    binding,
    profileId: profile.id,
    profileVersionAtCapture: profile.version,
    targetGenerationAtCapture: target.generation,
    birthEpoch: input.epoch,
  });
  if (input.expected !== undefined && hash(proof) !== hash(input.expected))
    protectedManagement();
  invocation.execution.assertActive();
  return {
    proof,
    freshness: {
      expiresAtMs: invocation.execution.expiresAtMs,
      assertActive: invocation.execution.assertActive,
    },
  };
}

function managementPolicy(
  original: LibraryHandoffReceipt,
  target: MediaIntent,
  input: ManagementInput,
) {
  const { selection, receipt } = original;
  const selected = selection.scope.media.filter(
    (media) => media.mediaId === input.scope.mediaId,
  );
  const policy = selected[0];
  const network = z
    .object({
      plex: z.array(
        z.object({
          mediaId: z.string(),
          edition: z.string(),
          sectionId: z.string(),
        }),
      ),
    })
    .parse(selection.networkEvidence);
  const sections = network.plex.filter(
    (item) =>
      item.mediaId === input.scope.mediaId &&
      item.edition === input.scope.edition,
  );
  if (
    policy?.profileId == null ||
    selected.length !== 1 ||
    !policy.monitored ||
    receipt.recoveryEpoch !== input.epoch ||
    !target.monitoring ||
    !target.desiredPresence ||
    target.intentionallyRemovedAt !== null ||
    target.automationEpoch !== input.epoch ||
    target.editionRootId !== input.scope.rootMediaId ||
    target.profileId !== policy.profileId ||
    sections.length !== 1 ||
    sections[0]?.sectionId !== input.access.movieSectionId ||
    !selection.scope.files.some(
      (file) =>
        file.libraryKind === "movies" &&
        file.edition === input.scope.edition &&
        file.mediaIds.length === 1 &&
        file.mediaIds[0] === input.scope.mediaId,
    )
  )
    protectedManagement();
  return { ...policy, profileId: policy.profileId };
}

async function managementBinding(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
    expected?: LibraryMovieManagementAuthority;
  },
  invocation: MovieManagementInvocation,
) {
  if (input.expected !== undefined) {
    const binding = input.expected.binding;
    const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
      where: { id: binding.evidenceId },
    });
    invocation.budget.consume(1);
    const association = parsePlexRecord(
      PlexMovieAssociationV2Schema,
      evidence.evidence,
      evidence.associationHash,
    );
    if (
      evidence.associationHash !== binding.associationHash ||
      association.access.serverMachineId !== input.access.serverMachineId ||
      association.access.sectionId !== input.access.movieSectionId ||
      hash(association.scope) !==
        hash({ mediaId: input.scope.mediaId, edition: input.scope.edition })
    )
      protectedManagement();
    return binding;
  }
  const assets = await tx.assetCoverage.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
    },
    take: 2,
  });
  const selected = assets[0];
  if (selected === undefined || assets.length !== 1) protectedManagement();
  const result = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
      assetId: selected.assetId,
      access: {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        sectionType: "movie",
      },
    },
    invocation.budget,
  );
  if (result.status !== "current") protectedManagement();
  return result.snapshot;
}
