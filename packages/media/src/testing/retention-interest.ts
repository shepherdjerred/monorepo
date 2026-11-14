import { expect } from "vitest";
import type { MediaAutomationContext } from "#automation/context.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { nativeInterestFacts } from "#infrastructure/request-interest/facts.ts";
import { reconcileRequestInterests } from "#infrastructure/request-interest/reconcile.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";

/** Explicit initial external-catalog facts for retention-eligible direct episode
 * fixtures only. Generic catalog defaults and future/unknown controls stay intact. */
export async function seedFixtureReleasedEpisodes(
  db: Database,
  userId: string,
) {
  const requests = await db.mediaRequest.findMany({
    where: {
      userId,
      direct: true,
      active: true,
      excluded: false,
      media: { kind: "episode" },
    },
    include: { media: true },
  });
  expect(requests.length).toBeGreaterThan(0);
  const mediaIds = [...new Set(requests.map((request) => request.mediaId))];
  expect(
    await db.assetCoverage.count({ where: { mediaId: { in: mediaIds } } }),
  ).toBe(0);
  expect(
    await db.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: mediaIds } },
    }),
  ).toBe(0);
  const releasedAt = new Date(Date.now() - 86_400_000);
  const episodes = new Map(
    requests.map((request) => [request.mediaId, request.media]),
  );
  for (const [mediaId, media] of episodes) {
    expect(media.airDate).toBeNull();
    await db.mediaItem.update({
      where: { id: mediaId },
      data: { airDate: releasedAt, originalLanguage: "en" },
    });
  }
}

/** Run the actual watched-release producer before a retention command captures
 * its generation. Unknown metadata, current playback or Keep never become consent. */
export async function completeFixtureRetentionInterests(
  context: MediaAutomationContext,
  mediaIds: readonly string[],
  edition: MovieEditionKey = "default",
) {
  const db = context.db;
  for (const mediaId of [...new Set(mediaIds)].sort())
    expect(await observeRequesterWatch(context, mediaId, { edition })).toEqual({
      complete: true,
      reason: null,
    });
  const requests = await db.mediaRequest.findMany({
    where: {
      mediaId: { in: [...mediaIds] },
      edition,
      active: true,
      direct: true,
      excluded: false,
    },
    orderBy: { id: "asc" },
  });
  expect(requests.length).toBeGreaterThan(0);
  const events: Awaited<ReturnType<typeof db.applicationEvent.findMany>> = [];
  for (const request of requests) {
    expect(request).toMatchObject({
      keepingPolicy: "temporary",
      interestState: "following",
      interestReleasedAt: null,
      interestReleaseReason: null,
    });
    const now = new Date();
    const facts = await db.$transaction((tx) =>
      nativeInterestFacts(tx, request, now),
    );
    expect(facts).toMatchObject({
      watchedComplete: true,
      requestedCoverageComplete: true,
      usableUnwatched: false,
    });
    // The native activity processes one ordered row. Start at its immediate
    // predecessor so another test's request in this shared DB is never advanced.
    const predecessor = await db.mediaRequest.findFirst({
      where: { id: { lt: request.id } },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const newProgressAt =
      facts.progressAt !== null &&
      facts.progressAt > (request.lastMeaningfulProgressAt?.getTime() ?? 0)
        ? facts.progressAt
        : null;
    const cycles = newProgressAt === null ? 1 : 2;
    for (let cycle = 0; cycle < cycles; cycle++) {
      expect(
        await reconcileRequestInterests(db, {
          cursor: predecessor?.id ?? null,
          now,
        }),
      ).toEqual({ processed: 1, nextCursor: request.id });
      if (newProgressAt !== null && cycle === 0) {
        expect(
          await db.mediaRequest.findUniqueOrThrow({
            where: { id: request.id },
          }),
        ).toMatchObject({
          interestState: "following",
          interestReleasedAt: null,
          interestReleaseReason: null,
          interestRevision: request.interestRevision + 1,
          lastMeaningfulProgressAt: new Date(newProgressAt),
        });
        expect(
          await db.applicationEvent.count({
            where: {
              kind: "request_interest_released",
              payload: { path: ["requestId"], equals: request.id },
            },
          }),
        ).toBe(0);
      }
    }
    const current = await db.mediaRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(current).toMatchObject({
      active: true,
      direct: true,
      excluded: false,
      keepingPolicy: "temporary",
      interestState: "finished",
      interestReleasedAt: now,
      interestReleaseReason: "watched",
      interestRevision: request.interestRevision + cycles,
    });
    const released = await db.applicationEvent.findMany({
      where: {
        mediaId: request.mediaId,
        kind: "request_interest_released",
        payload: { path: ["requestId"], equals: request.id },
      },
    });
    expect(released).toHaveLength(1);
    expect(released[0]?.payload).toEqual({
      requestId: request.id,
      userId: request.userId,
      interestRevision: current.interestRevision,
      reason: "watched",
    });
    events.push(...released);
  }
  // Retain the exact append-only producer observations across all other releases.
  expect(
    await db.applicationEvent.findMany({
      where: { id: { in: events.map((event) => event.id) } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(events.toSorted((left, right) => left.id.localeCompare(right.id)));
}
