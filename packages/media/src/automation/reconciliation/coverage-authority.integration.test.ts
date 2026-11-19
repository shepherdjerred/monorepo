import { expect, test } from "vitest";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestLease } from "#testing/authority.ts";
import { createCoverageActivities } from "./coverage.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { householdRetentionState } from "#infrastructure/request-interest/protection.ts";
import { followingCoverageFixture } from "./coverage-following/test-fixture.ts";
import { z } from "zod";

const harness = automationTestHarness();
test("observe-mode bootstrap projects metadata without granting or downgrading leaf authority", async () => {
  const f = await setup();
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: -1 },
  });
  const root = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: { version: { increment: 1 }, coverageCompletedAt: null },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Metadata-only episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: root.version,
    }),
  ).toMatchObject({ processed: 2 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.user.id,
          mediaId: future.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ active: true, direct: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1, monitoring: true });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 0 });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
  ).toMatchObject({ coverageCompletedAt: expect.any(Date) });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: 0 },
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: 1 },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: root.version,
    }),
  ).toEqual({ processed: 0, nextCursor: null });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.series.id, edition: "default" } },
    data: { automationEpoch: -1 },
  });
  const renewed = await f.db.mediaRequest.update({
    where: { id: root.id },
    data: { version: { increment: 1 } },
  });
  expect(
    await f.activity.expandMediaRequest({
      ...f.input,
      requestVersion: renewed.version,
    }),
  ).toMatchObject({ processed: 2 });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 1 });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1 });
});

async function setup() {
  const base = await harness.fixture();
  const db = harness.database();
  const series = await db.mediaItem.create({
    data: {
      kind: "series",
      title: "Restored series",
    },
  });
  await createTestDefaultTarget(db, series.id, { automationEpoch: 0 });
  const root = await db.mediaRequest.create({
    data: {
      userId: base.user.id,
      mediaId: series.id,
      includeFutureEpisodes: true,
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Selected episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  const activity = createCoverageActivities({ db });
  const input = {
    requestId: root.id,
    requestVersion: root.version,
    operationId: crypto.randomUUID(),
    cursor: null,
  };
  await activity.expandMediaRequest(input);
  return { db, series, root, episode, activity, input, user: base.user };
}

test("catalog expansion cannot renew an old root or its leaves after runtime recovery", async () => {
  const f = await setup();
  const before = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
  });
  await grantTestLease(f.db, 1);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  expect(await f.activity.expandMediaRequest(f.input)).toEqual({
    processed: 0,
    nextCursor: null,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toEqual(before);
  expect(
    await f.db.mediaIntent.findUnique({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toBeNull();
  expect(await f.db.mediaRequest.count({ where: { mediaId: future.id } })).toBe(
    0,
  );
});

test("negative leaf declarations survive fresh root versions and future episodes without epoch renewal", async () => {
  const f = await setup();
  await f.db.mediaRequest.update({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.episode.id,
        edition: "default",
      },
    },
    data: {
      direct: true,
      excluded: true,
      active: false,
      version: { increment: 1 },
    },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: -1, monitoring: false },
  });
  const root = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: { version: { increment: 1 } },
  });
  const future = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Future episode",
      parentId: f.series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await f.activity.expandMediaRequest({
    ...f.input,
    requestVersion: root.version,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.user.id,
          mediaId: f.episode.id,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ direct: true, excluded: true, active: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: -1, monitoring: false });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: future.id, edition: "default" } },
    }),
  ).toMatchObject({
    automationEpoch: 0,
    desiredPresence: true,
    monitoring: true,
  });
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: root.id } }),
  ).toMatchObject({
    version: root.version,
    includeFutureEpisodes: true,
    active: true,
  });
});

test("old-root cancellation can remove inherited authority without downgrading a current direct leaf", async () => {
  const f = await setup();
  await grantTestLease(f.db, 1);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  await f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    data: { automationEpoch: 1 },
  });
  await f.db.mediaRequest.update({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.episode.id,
        edition: "default",
      },
    },
    data: { direct: true },
  });
  const cancelled = await f.db.mediaRequest.update({
    where: { id: f.root.id },
    data: {
      active: false,
      excluded: true,
      direct: false,
      version: { increment: 1 },
    },
  });
  await f.activity.expandMediaRequest({
    ...f.input,
    requestVersion: cancelled.version,
  });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.episode.id, edition: "default" } },
    }),
  ).toMatchObject({ automationEpoch: 1, monitoring: true });
  expect(
    await f.db.requestCoverage.findUniqueOrThrow({
      where: {
        rootRequestId_mediaId: {
          rootRequestId: f.root.id,
          mediaId: f.episode.id,
        },
      },
    }),
  ).toMatchObject({ active: false });
});

test("a following series sponsors a real pack through an independently finished direct episode", async () => {
  const f = await followingCoverageFixture(harness);
  const ids = f.episodes.map((episode) => episode.id).sort();
  expect(
    await f.db.mediaRequest.count({
      where: {
        userId: f.user.id,
        mediaId: { in: ids },
        ...effectiveRequestWhere,
      },
    }),
  ).toBe(2);
  expect(
    await f.db.$transaction((tx) => householdRetentionState(tx, f.episode.id)),
  ).toMatchObject({ reason: "requester_still_following" });
  const attemptId = z.uuid().parse(await f.reserve());
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  expect(attempt).toMatchObject({
    state: "reserved",
    sponsorRequestId: f.finished.id,
  });
  expect([...attempt.mediaIds].sort()).toEqual(ids);
  expect(attempt.identityEvidence).toMatchObject({
    schemaVersion: 1,
    sponsorRequestId: f.finished.id,
    sponsorAuthority: {
      userId: f.user.id,
      actorId: f.user.id,
      serverMachineId: "fixture-server",
    },
  });
  expect(
    await f.db.acquisitionReservation.count({ where: { attemptId } }),
  ).toBe(2);
  expect(
    await f.db.requestCoverage.count({
      where: { rootRequestId: f.root.id, mediaId: { in: ids }, active: true },
    }),
  ).toBe(2);
  expect(
    await f.db.requestCoverage.count({
      where: { rootRequestId: f.finished.id },
    }),
  ).toBe(0);
  await expect(f.recheck(attemptId)).resolves.toMatchObject({
    schemaVersion: 1,
  });
  await expectFinishedDeclaration(f);
});

test.each(["root_drop", "root_cancel", "leaf_excluded", "restricted"] as const)(
  "following-parent acquisition retains its live boundary at %s",
  async (mode) => {
    const f = await followingCoverageFixture(harness);
    const attemptId = z.uuid().parse(await f.reserve());
    if (mode === "root_drop") await f.change(f.root.id, "drop");
    else if (mode === "restricted") {
      const user = await f.db.mediaUser.findUniqueOrThrow({
        where: { id: f.user.id },
      });
      await f.commands.restrictUser(f.owner, crypto.randomUUID(), user.id, {
        expectedVersion: user.version,
        restricted: true,
      });
    } else {
      const requestId = mode === "root_cancel" ? f.root.id : f.finished.id;
      const request = await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      await f.commands.cancelRequest(
        f.user,
        crypto.randomUUID(),
        requestId,
        request.version,
      );
    }
    // No paginated coverage cleanup is run: the live root and leaf masks decide now.
    expect(
      await f.db.requestCoverage.count({
        where: { rootRequestId: f.root.id, active: true },
      }),
    ).toBe(2);
    expect(
      await f.db.mediaRequest.count({
        where: { id: f.finished.id, ...effectiveRequestWhere },
      }),
    ).toBe(mode === "restricted" ? 1 : 0);
    await expect(f.recheck(attemptId)).rejects.toMatchObject({
      code:
        mode === "restricted"
          ? "requests_restricted"
          : "acquisition_sponsor_changed",
    });
    await expectFinishedDeclaration(f);
  },
);

async function expectFinishedDeclaration(
  f: Awaited<ReturnType<typeof followingCoverageFixture>>,
) {
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: f.finished.id } }),
  ).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "finished_manually",
    interestRevision: f.finished.interestRevision,
    interestReleasedAt: f.finished.interestReleasedAt,
    interestRenewedAt: f.finished.interestRenewedAt,
    lastMeaningfulProgressAt: f.finished.lastMeaningfulProgressAt,
  });
}
