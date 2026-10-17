import { expect, test } from "vitest";
import { recoveryHarness, releaseInput } from "./test-support.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";

const { fixture } = recoveryHarness();
test("selected completed-root leaves reconcile without changing outside intent, claims, pins or future options", async () => {
  const f = await fixture();
  const series = await f.db.mediaItem.create({
    data: {
      kind: "series",
      title: "Shared series",
      intent: { create: { automationEpoch: 3 } },
    },
  });
  await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: {
      kind: "episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
      externalIds: { plexSectionId: "2" },
    },
  });
  const outside = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Outside review",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: { plexSectionId: "2" },
      intent: { create: { automationEpoch: -1 } },
    },
  });
  const root = await f.db.mediaRequest.create({
    data: {
      userId: f.member.id,
      mediaId: series.id,
      includeFutureEpisodes: true,
      includeSpecials: false,
      coverageCompletedAt: new Date(),
    },
  });
  const outsideClaim = await f.db.mediaRequest.create({
    data: { userId: f.member.id, mediaId: outside.id, direct: false },
  });
  await f.db.requestCoverage.createMany({
    data: [
      {
        rootRequestId: root.id,
        requestId: f.claim.id,
        mediaId: f.media.id,
        sourceVersion: root.version,
      },
      {
        rootRequestId: root.id,
        requestId: outsideClaim.id,
        mediaId: outside.id,
        sourceVersion: root.version,
      },
    ],
  });
  const pin = await f.db.retentionHold.create({
    data: { userId: f.member.id, mediaId: outside.id, isPin: true },
  });
  const outsideIntent = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId: outside.id },
  });
  const review = await f.prepare();
  expect(review.scope.blockers).toEqual([]);
  for (const user of [f.owner, f.member])
    await f.service.respond(user, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: f.media.id, intent: "no_longer_request" }],
    });
  const answered = await f.service.detail(f.owner, review.id);
  await f.service.release(
    f.owner,
    crypto.randomUUID(),
    review.id,
    releaseInput(answered),
  );
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
  ).toEqual(root);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: outsideClaim.id },
    }),
  ).toEqual(outsideClaim);
  expect(
    await f.db.retentionHold.findUniqueOrThrow({ where: { id: pin.id } }),
  ).toEqual(pin);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: outside.id },
    }),
  ).toEqual(outsideIntent);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
  ).toMatchObject({ direct: true, active: false, excluded: true });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 3,
    },
  });
  await createCoverageActivities({ db: f.db }).expandMediaRequest({
    requestId: root.id,
    requestVersion: root.version,
    operationId: crypto.randomUUID(),
    cursor: null,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.claim.id } }),
  ).toMatchObject({ direct: true, active: false, excluded: true });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: { userId_mediaId: { userId: f.member.id, mediaId: future.id } },
    }),
  ).toMatchObject({ active: true, excluded: false, direct: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: outside.id },
    }),
  ).toEqual(outsideIntent);
});
