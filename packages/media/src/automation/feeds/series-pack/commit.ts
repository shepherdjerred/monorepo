import type { MediaAutomationContext } from "#automation/context.ts";
import type { MediaIntent } from "#generated/prisma/client.ts";
import { z } from "zod";
import { queueOperation, serializable } from "#automation/store.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import {
  lockEffectiveRequests,
  effectiveRequestWhere,
} from "#infrastructure/request-claims.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { reservationAuthority } from "#automation/acquisition-management/reservation.ts";
import { captureSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import { recordSeriesPackSelectionV1 } from "#infrastructure/acquisition-identity/series-pack/selection.ts";
import { assertSeriesPackAuthorityV1 } from "#infrastructure/acquisition-identity/series-pack/authority.ts";
import { loadSeriesPackInterpretationV1 } from "#infrastructure/acquisition-identity/series-pack/parent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { FeedMatchTarget } from "#automation/feeds/selection.ts";
import type { CapturedSeriesPackV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { MatchFeedSourceV1 } from "#shared/feeds/contract.ts";
import {
  advanceSeriesPackFeedV1,
  seriesPackFeedCommandV1,
  cursorPosition,
} from "./command.ts";

/** Only complete current request or household authority can queue this actual selected interpretation. */
export async function commitSeriesPackFeedV1(
  context: MediaAutomationContext,
  input: {
    command: MatchFeedSourceV1;
    target: FeedMatchTarget;
    captured: CapturedSeriesPackV1;
    providerId: string;
    completed: boolean;
  },
) {
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw new Error("Series pack feed lost its original invocation");
  return serializable(context.db, async (tx) => {
    const mediaIds = input.captured.attributes.mediaIds;
    await lockAcquisitionMedia(tx, mediaIds);
    await lockEffectiveRequests(tx, mediaIds);
    if (!(await lockRuntimeAuthority(tx, input.target.automationEpoch)))
      return null;
    await tx.$queryRaw`SELECT id FROM "MediaProvider" WHERE id=${input.providerId} FOR SHARE`;
    const provider = await tx.mediaProvider.findUniqueOrThrow({
      where: { id: input.providerId },
    });
    if (!provider.enabled || !(await context.gates.acquisition())) return null;
    await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.command.operationId} FOR UPDATE`;
    const command = await seriesPackFeedCommandV1(
      tx,
      input.command,
      invocation,
    );
    const cursor = {
      mediaId: input.target.mediaId,
      edition: input.target.edition,
    };
    if (
      command.progress.completed ||
      (command.progress.cursor !== null &&
        cursorPosition(command.progress.cursor) >= cursorPosition(cursor))
    )
      return command.progress;
    const targets = await tx.mediaIntent.findMany({
      where: { mediaId: { in: mediaIds }, edition: "default" },
      orderBy: { mediaId: "asc" },
    });
    const primary = currentPackTargetV1(targets, input.target, mediaIds.length);
    if (primary === undefined) return null;
    const parent = await loadSeriesPackInterpretationV1(
      tx,
      input.captured,
      invocation.budget,
    );
    await assertSeriesPackAuthorityV1(
      tx,
      {
        captured: input.captured,
        release: parent.source,
        canonical: parent.value.canonical,
        mediaIds,
        primaryMediaId: primary.mediaId,
      },
      invocation,
    );
    const authority = await reservationAuthority(tx, context, {
      mediaId: primary.mediaId,
      mediaIds,
      epoch: primary.automationEpoch,
      movieAccess: undefined,
    });
    if (authority === null) return null;
    if (authority.kind === "request") {
      const requests = await tx.mediaRequest.findMany({
        where: { ...effectiveRequestWhere, mediaId: { in: mediaIds } },
        select: { mediaId: true },
      });
      const claimed = new Set(requests.map((request) => request.mediaId));
      if (mediaIds.some((id) => !claimed.has(id))) return null;
    }
    const generations = targets.map((target) => ({
      mediaId: target.mediaId,
      generation: target.generation,
    }));
    const operationId = await queueOperation(tx, {
      key: `feed-series-pack-v1:${input.command.sourceId}:${parent.value.seriesId}:${input.captured.operationId}:${String(primary.automationEpoch)}:${identityHash(generations)}`,
      kind: "reconcile_media",
      targetId: primary.mediaId,
      payload: {
        mediaId: primary.mediaId,
        generation: primary.generation,
        releaseId: parent.value.releaseId,
        cursor: null,
      },
      budget: invocation.budget,
    });
    const queued = await tx.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    invocation.budget.consume(1);
    const coordinator = z
      .object({
        operationId: z.uuid(),
        mediaId: z.uuid(),
        generation: z.int().nonnegative(),
      })
      .parse(queued.payload);
    const originalPrimary = targets.find(
      (target) => target.mediaId === coordinator.mediaId,
    );
    if (
      queued.kind !== "reconcile_media" ||
      queued.targetId !== coordinator.mediaId ||
      coordinator.operationId !== operationId ||
      originalPrimary?.generation !== coordinator.generation
    )
      throw new Error(
        "Series pack feed lost its actual original queued cohort",
      );
    if (authority.kind === "request")
      await captureSponsorAuthority(tx, {
        operationId,
        sponsorRequestId: authority.sponsor.id,
        mediaIds,
        serverMachineId: invocation.access.serverMachineId,
      });
    await recordSeriesPackSelectionV1(
      tx,
      {
        operationId,
        primaryMediaId: coordinator.mediaId,
        generation: coordinator.generation,
        captured: input.captured,
      },
      invocation,
    );
    return advanceSeriesPackFeedV1(
      tx,
      {
        operationId: input.command.operationId,
        sourceId: input.command.sourceId,
        prior: command.raw,
        next: {
          ...command.progress,
          cursor,
          completed: input.completed,
          protection: null,
        },
      },
      invocation,
    );
  });
}

function currentPackTargetV1(
  targets: MediaIntent[],
  expected: FeedMatchTarget,
  count: number,
) {
  const primary = targets.find((target) => target.mediaId === expected.mediaId);
  if (
    primary === undefined ||
    targets.length !== count ||
    primary.generation !== expected.generation ||
    primary.version !== expected.version ||
    primary.profileId !== expected.profileId ||
    targets.some(
      (target) =>
        target.editionRootId !== expected.editionRootId ||
        target.automationEpoch !== expected.automationEpoch ||
        !target.desiredPresence ||
        !target.monitoring ||
        target.intentionallyRemovedAt !== null,
    )
  )
    return;
  return primary;
}
