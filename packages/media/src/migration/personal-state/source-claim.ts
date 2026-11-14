import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import {
  movieDefinitionRef,
  matchesMovieDefinition,
} from "#infrastructure/movie-editions/definition.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { commandAutomationEpoch } from "#infrastructure/handoff/authority.ts";
import { personalRequestGenerationChange } from "#infrastructure/library-monitoring/intent.ts";
import { invalidateRetention } from "#infrastructure/action-guards.ts";

/** Source approval is imported interest. It is never a fabricated self/owner
 * MovieEditionChoice and cannot grant a fresh movie acquisition. */
export async function createImportedSourceClaim(
  tx: Prisma.TransactionClient,
  subject: { mediaId: string; userId: string; edition: MovieEditionKey },
) {
  const { mediaId, userId, edition } = subject;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
  });
  if (media.kind === "movie") {
    await lockMovieCommand(tx, { rootMediaId: mediaId, mediaId, edition });
    const ref = movieDefinitionRef(mediaId, edition);
    const stored = await tx.mediaEditionDefinition.findUnique({
      where: { rootMediaId_key: { rootMediaId: mediaId, key: edition } },
    });
    if (stored !== null && !matchesMovieDefinition(stored, ref.definition))
      throw new Error("Imported movie edition definition changed");
    if (stored === null)
      await tx.mediaEditionDefinition.create({
        data: {
          ...ref.definition,
          displayLabel: movieEditionDisplayLabel(edition),
        },
      });
    await tx.mediaIntent.upsert({
      where: { mediaId_edition: { mediaId, edition } },
      create: { mediaId, edition, editionRootId: mediaId },
      update: {},
    });
  } else
    await lockDefaultScopes(tx, [{ mediaId, edition: "default" }], {
      createMissing: true,
    });
  const existing = await tx.mediaRequest.findUnique({
    where: { userId_mediaId_edition: { mediaId, userId, edition } },
  });
  if (existing !== null)
    return { request: existing, command: null, needsAcquisitionChoice: false };
  const request = await tx.mediaRequest.create({
    data: {
      mediaId,
      userId,
      edition,
      keepingPolicy: "temporary",
      interestState: "following",
      active: true,
      direct: true,
      excluded: false,
      includeFutureEpisodes: false,
      includeSpecials: media.seasonNumber === 0,
    },
  });
  await tx.retentionDecision.updateMany({
    where: {
      mediaId,
      edition,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
  if (media.kind === "movie")
    return { request, command: null, needsAcquisitionChoice: true };
  const prior = await tx.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition } },
  });
  const epoch = await commandAutomationEpoch(tx);
  if (epoch < 0)
    throw new Error("Activate Media before importing following TV claims");
  const defaults = await tx.qualityProfileDefault.findUnique({
    where: { kind: "series" },
  });
  const intent = await tx.mediaIntent.update({
    where: { mediaId_edition: { mediaId, edition } },
    data: {
      desiredPresence: true,
      monitoring: true,
      intentionallyRemovedAt: null,
      automationEpoch: epoch,
      profileId: prior.profileId ?? defaults?.profileId ?? null,
      ...personalRequestGenerationChange(prior, epoch),
      version: { increment: 1 },
    },
  });
  await invalidateRetention(tx, mediaId);
  await tx.mediaItem.update({
    where: { id: mediaId },
    data: { version: { increment: 1 } },
  });
  return {
    request,
    needsAcquisitionChoice: false,
    command: {
      kind: "expand_request",
      mediaId,
      generation: intent.generation,
      details: {
        requestId: request.id,
        requestVersion: request.version,
        cursor: null,
      },
    },
  };
}
