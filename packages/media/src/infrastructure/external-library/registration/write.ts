import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  ExternalLibraryRegistrationSchema,
  ExternalLibraryApplyResultSchema,
  EXTERNAL_LIBRARY_REGISTERED_EVENT,
} from "#shared/external-library/contract.ts";
import type { ExternalLibraryApplyInput } from "#shared/external-library/contract.ts";
import type { ExternalRegistrationPlan } from "./contract.ts";

/** Explicit registration records passive presence, never owned serving or target authority. */
export async function writeExternalRegistration(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: ExternalLibraryApplyInput,
  plan: ExternalRegistrationPlan,
) {
  const operationId = crypto.randomUUID();
  const ids = plan.members.map((member) => member.mediaId);
  let assetId = plan.existingAssetId;
  if (plan.disposition === "eligible") {
    await lockDefaultScopes(
      tx,
      ids.map((id) => defaultScope(id)),
      { createMissing: true },
    );
    const registrationEventId = crypto.randomUUID();
    const observed = plan.observation;
    const registration = ExternalLibraryRegistrationSchema.parse({
      schemaVersion: 1,
      source: "plex",
      registrationEventId,
      registeredAt: new Date().toISOString(),
      serverMachineId: observed.serverMachineId,
      sectionId: observed.sectionId,
      sectionType: observed.sectionType,
      rootMediaId: plan.root.id,
      rootTmdbId: plan.root.tmdbId,
      rootYear: plan.root.year,
      rootCatalogIdentityHash: plan.root.catalogIdentityHash,
      edition: "default",
      observedEditionTitle: observed.observedEditionTitle,
      canonicalEdition: null,
      editionConfidence: "unknown",
      canonicalPath: observed.canonicalPath,
      sizeBytes: observed.sizeBytes,
      members: observed.members.map((member, index) => {
        const canonical = plan.members[index];
        if (canonical === undefined)
          throw new Error(
            "External registration lost exact canonical coverage",
          );
        return {
          mediaId: canonical.mediaId,
          ratingKey: member.ratingKey,
          partId: member.partId,
          guids: member.guids,
          seasonNumber: member.seasonNumber,
          episodeNumber: member.episodeNumber,
        };
      }),
    });
    await tx.applicationEvent.create({
      data: {
        id: registrationEventId,
        mediaId: plan.root.id,
        actorId: actor.id,
        kind: EXTERNAL_LIBRARY_REGISTERED_EVENT,
        payload: { registration, registrationHash: identityHash(registration) },
      },
    });
    const asset = await tx.libraryAsset.create({
      data: {
        path: observed.canonicalPath,
        sizeBytes: BigInt(observed.sizeBytes),
        state: "published",
        owned: false,
        ownershipEpoch: -1,
        checksum: null,
        torrentId: null,
        edition: "default",
        editionRootId: plan.root.id,
        properties: { externalLibrary: registration },
        coverage: {
          create: ids.map((mediaId) => ({
            mediaId,
            current: true,
          })),
        },
      },
    });
    assetId = asset.id;
  }
  const result = ExternalLibraryApplyResultSchema.parse({
    operationId,
    status: "completed",
    disposition:
      plan.disposition === "eligible" ? "registered" : plan.disposition,
    reason: plan.reason,
    assetId,
    mediaIds: ids,
    externalOnly: true,
  });
  await tx.operation.create({
    data: {
      id: operationId,
      userId: actor.id,
      kind: "register_external_library",
      targetId: plan.root.id,
      payload: { operationId, ...input },
      status: "completed",
      result: z.record(z.string(), z.json()).parse(result),
    },
  });
  return result;
}
