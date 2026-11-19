import type { MediaRequest, Prisma } from "#generated/prisma/client.ts";
import {
  mappingCurrent,
  catalogCurrent,
  terminalStatus,
  requestLeaves,
} from "./fact-scope.ts";
import { observeInterestLeaf, type LeafObservation } from "./fact-leaf.ts";
import { usableInterestBacklog } from "#domain/household/interests.ts";

const MAX_COVERAGE = 1000;
/** This is current, identity-bound observation. Historical playback never participates. */
export async function nativeInterestFacts(
  tx: Prisma.TransactionClient,
  request: MediaRequest,
  now: Date,
) {
  const root = await tx.mediaItem.findUniqueOrThrow({
    where: { id: request.mediaId },
    include: { parent: true },
  });
  const mapping = await tx.plexIdentityMapping.findUnique({
    where: { userId: request.userId },
  });
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const unknown = {
    usableUnwatched: null,
    watchedComplete: null,
    completionComplete: null,
    requestedCoverageComplete: false,
    progressAt: null,
    terminalStatus: "unknown",
    terminalObservedAt: null,
  } as const;
  if (
    mapping?.serverAccountId == null ||
    !mappingCurrent(mapping, root.kind, now)
  )
    return unknown;
  const series = root.kind === "season" ? root.parent : root;
  if (!catalogCurrent(root.kind, series, request, now)) return unknown;
  const leaves = await requestLeaves(tx, root, request);
  if (leaves.length === 0 || leaves.length > MAX_COVERAGE) return unknown;
  const observations: LeafObservation[] = [];
  for (const leaf of leaves) {
    const observation = await observeInterestLeaf(tx, {
      leaf,
      request,
      mapping,
      epoch: runtime.recoveryEpoch,
      now,
      originalLanguage: series?.originalLanguage ?? null,
    });
    if (observation.state === "unknown") return unknown;
    observations.push(observation);
  }
  const progress = await tx.playbackSession.findFirst({
    where: {
      userId: request.userId,
      serverMachineId: mapping.serverMachineId,
      serverAccountId: mapping.serverAccountId,
      ratingKey: {
        in: observations.flatMap((value) =>
          value.ratingKey === null ? [] : [value.ratingKey],
        ),
      },
      source: "plex",
      meaningfulProgressAt: cycleProgressWhere(request, now),
    },
    orderBy: { meaningfulProgressAt: "desc" },
    select: { meaningfulProgressAt: true },
  });
  return {
    ...observedCoverageFacts(request, observations),
    progressAt: progress?.meaningfulProgressAt?.getTime() ?? null,
    terminalStatus: terminalStatus(series?.seriesStatus ?? null),
    terminalObservedAt: series?.seriesStatusObservedAt?.getTime() ?? null,
  };
}

function cycleProgressWhere(request: MediaRequest, now: Date) {
  return {
    not: null,
    lte: now,
    ...(request.completionRequiredAfter === null
      ? {}
      : { gt: request.completionRequiredAfter }),
  };
}

function observedCoverageFacts(
  request: MediaRequest,
  observations: readonly LeafObservation[],
) {
  return {
    // Current watched truth remains unchanged. A renewed cycle can still have
    // usable rewatch content while its old watched counter proves no new finish.
    usableUnwatched:
      request.completionRequiredAfter === null
        ? usableInterestBacklog(observations.map((value) => value.state))
        : observations.every((value) => value.usable === true) &&
          observations.some((value) => !value.completionCurrent),
    watchedComplete: observations.every((value) => value.state === "watched"),
    completionComplete: observations.every((value) => value.completionCurrent),
    requestedCoverageComplete: observations.every(
      (value) =>
        value.state !== "unavailable" &&
        (request.completionRequiredAfter === null || value.usable === true),
    ),
  };
}
