import type { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type {
  Prisma,
  MediaItem,
  MediaReleaseDate,
} from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { RequestInterestProgressSchema } from "#shared/household/progress.ts";
import { CalendarDateSchema } from "#shared/household/calendar.ts";
import {
  catalogCurrent,
  mappingCurrent,
  requestLeaves,
  terminalStatus,
} from "./fact-scope.ts";
import { observeInterestLeaf, type LeafObservation } from "./fact-leaf.ts";
import { INTEREST_POLICY } from "#domain/household/interests.ts";

type Progress = z.infer<typeof RequestInterestProgressSchema>;
type Request = Prisma.MediaRequestGetPayload<{
  include: { media: { include: { parent: true; releaseDates: true } } };
}>;
type Leaves = Awaited<ReturnType<typeof requestLeaves>>;
const unknownCounts: Progress["counts"] = {
  requested: null,
  released: null,
  available: null,
  watched: null,
  captionsPending: null,
};

/** Explicitly loaded one request at a time. No writes, cached authority or list fanout. */
export async function getRequestInterestProgress(
  db: Database,
  actor: MediaActor,
  requestId: string,
) {
  return db.$transaction(
    async (tx) => {
      const currentActor = await tx.mediaUser.findUnique({
        where: { id: actor.id },
      });
      if (currentActor === null)
        throw new MediaError("unauthenticated", "Sign in again", 401);
      const request = await tx.mediaRequest.findFirst({
        where: {
          id: requestId,
          direct: true,
          ...(currentActor.role === "owner" && !currentActor.restricted
            ? {}
            : { userId: currentActor.id }),
        },
        include: { media: { include: { parent: true, releaseDates: true } } },
      });
      if (request === null)
        throw new MediaError("not_found", "Request not found", 404);
      return readProgress(tx, request, new Date());
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}

async function readProgress(
  tx: Prisma.TransactionClient,
  request: Request,
  now: Date,
) {
  const root = request.media;
  const series = root.kind === "season" ? root.parent : root;
  const counts = { ...unknownCounts };
  const result = (status: Progress["status"], reason: string | null) =>
    RequestInterestProgressSchema.parse({
      schemaVersion: 1,
      requestId: request.id,
      observedAt: now.toISOString(),
      status,
      reason,
      counts,
    });
  if (!catalogCurrent(root.kind, series, request, now))
    return result("unknown", "catalog_or_requested_coverage_not_current");
  const leaves = await requestLeaves(tx, root, request);
  if (leaves.length > 1000)
    return result("unknown", "requested_coverage_exceeds_observation_bound");
  counts.requested = leaves.length;
  if (leaves.length === 0) return result("unknown", "requested_coverage_empty");
  counts.released = releasedCount(leaves, root.releaseDates, now);
  const observationInput = { request, leaves, series, now };
  const observations = await observeProgress(tx, observationInput);
  if (observations === null)
    return result("unknown", "requester_access_not_current");
  if (observations.some((value) => value.state === "unknown"))
    return result("unknown", "current_playback_or_caption_authority_unknown");
  counts.available = observations.filter(
    (value) => value.state === "watched" || value.state === "unwatched",
  ).length;
  counts.watched = observations.filter(
    (value) => value.state === "watched",
  ).length;
  counts.captionsPending = observations.filter(
    (value) => value.state === "subtitles_pending",
  ).length;
  const disposition = progressDisposition({
    ...observationInput,
    observations,
  });
  return result(disposition.status, disposition.reason);
}

async function observeProgress(
  tx: Prisma.TransactionClient,
  input: {
    request: Request;
    leaves: Leaves;
    series: MediaItem | null;
    now: Date;
  },
) {
  const { request, leaves, series, now } = input;
  const mapping = await tx.plexIdentityMapping.findUnique({
    where: { userId: request.userId },
  });
  if (
    mapping?.serverAccountId == null ||
    !mappingCurrent(mapping, request.media.kind, now)
  )
    return null;
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const observations: LeafObservation[] = [];
  for (const leaf of leaves)
    observations.push(
      await observeInterestLeaf(tx, {
        leaf,
        request,
        mapping,
        epoch: runtime.recoveryEpoch,
        now,
        originalLanguage: series?.originalLanguage ?? null,
      }),
    );
  return observations;
}

function releasedCount(
  leaves: Leaves,
  dates: MediaReleaseDate[],
  now: Date,
): number | null {
  if (leaves[0]?.kind !== "episode") {
    const known = dates.filter(
      (date) =>
        date.region === "US" &&
        date.precision === "day" &&
        date.observedAt <= now,
    );
    if (known.length === 0) return null;
    const today = now.toISOString().slice(0, 10);
    return known.some((date) => CalendarDateSchema.parse(date.date) <= today)
      ? 1
      : 0;
  }
  return leaves.some((leaf) => leaf.airDate === null)
    ? null
    : leaves.filter((leaf) => leaf.airDate !== null && leaf.airDate <= now)
        .length;
}

function currentSeriesStatus(series: MediaItem | null, now: Date) {
  return series?.seriesStatusObservedAt == null ||
    series.seriesStatusObservedAt > now ||
    now.getTime() - series.seriesStatusObservedAt.getTime() >
      INTEREST_POLICY.metadataFreshMs
    ? "unknown"
    : terminalStatus(series.seriesStatus);
}

function progressDisposition(input: {
  request: Request;
  leaves: Leaves;
  observations: LeafObservation[];
  series: MediaItem | null;
  now: Date;
}): Pick<Progress, "status" | "reason"> {
  const { request, leaves, observations, series, now } = input;
  if (request.interestState !== "following")
    return { status: "released", reason: request.interestReleaseReason };
  const container =
    request.media.kind === "series" || request.media.kind === "season";
  const status = currentSeriesStatus(series, now);
  if (
    container &&
    status === "continuing" &&
    caughtUp(leaves, observations, now)
  )
    return { status: "caught_up", reason: "following_future_episodes" };
  if (observations.every((value) => value.state === "watched")) {
    return container && status === "unknown"
      ? { status: "unknown", reason: "series_status_not_current" }
      : { status: "complete", reason: null };
  }
  return { status: "following", reason: pendingReason(observations) };
}

function caughtUp(leaves: Leaves, observations: LeafObservation[], now: Date) {
  if (leaves.some((leaf) => leaf.airDate === null)) return false;
  const released = leaves.flatMap((leaf, index) =>
    leaf.airDate !== null && leaf.airDate <= now ? [observations[index]] : [],
  );
  return (
    released.length > 0 && released.every((value) => value?.state === "watched")
  );
}

function pendingReason(observations: LeafObservation[]) {
  if (observations.some((value) => value.state === "subtitles_pending"))
    return "required_english_captions_pending";
  return observations.some((value) => value.state === "unavailable")
    ? "requested_content_unavailable"
    : null;
}
