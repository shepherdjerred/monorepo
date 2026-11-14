import type { MediaRequest, Prisma } from "#generated/prisma/client.ts";
import {
  mappingCurrent,
  catalogCurrent,
  terminalStatus,
  requestLeaves,
} from "./fact-scope.ts";
import { observeInterestLeaf, type LeafObservation } from "./fact-leaf.ts";

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
      meaningfulProgressAt: { not: null, lte: now },
    },
    orderBy: { meaningfulProgressAt: "desc" },
    select: { meaningfulProgressAt: true },
  });
  return {
    usableUnwatched: observations.some((value) => value.state === "unwatched"),
    watchedComplete: observations.every((value) => value.state === "watched"),
    requestedCoverageComplete: observations.every(
      (value) => value.state !== "unavailable",
    ),
    progressAt: progress?.meaningfulProgressAt?.getTime() ?? null,
    terminalStatus: terminalStatus(series?.seriesStatus ?? null),
    terminalObservedAt: series?.seriesStatusObservedAt?.getTime() ?? null,
  };
}
