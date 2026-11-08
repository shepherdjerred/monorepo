import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";

const { fixture } = recoveryHarness();

test("missing respondent, immutable response replacement and replayed version cannot release", async () => {
  const f = await fixture();
  const review = await f.prepare();
  const body = {
    scopeHash: review.scopeHash,
    acknowledgePending: true as const,
    declarations: [{ mediaId: f.media.id, intent: "request" as const }],
  };
  await f.service.respond(f.owner, crypto.randomUUID(), review.id, body);
  const partial = await f.service.detail(f.owner, review.id);
  await expect(
    f.service.release(
      f.owner,
      crypto.randomUUID(),
      review.id,
      releaseInput(partial),
    ),
  ).rejects.toThrow("Every household member");
  await expect(
    f.service.respond(f.owner, crypto.randomUUID(), review.id, body),
  ).rejects.toThrow("immutable response already exists");
  await f.service.respond(f.member, crypto.randomUUID(), review.id, body);
  await expect(
    f.service.release(
      f.owner,
      crypto.randomUUID(),
      review.id,
      releaseInput(partial),
    ),
  ).rejects.toThrow("Review changed");
});

test.each(["keep", "pin", "epoch", "coverage", "request", "access"] as const)(
  "%s after owner preparation invalidates release and keeps the system hold",
  async (change) => {
    const f = await fixture();
    const review = await f.prepare();
    const ready = await f.responses(review.id);
    if (change === "keep" || change === "pin")
      await new PrismaMediaCommands(f.db, {
        keepDays: 30,
        serverMachineId: "fixture",
      }).act(f.owner, crypto.randomUUID(), f.media.id, {
        action: change,
        expectedVersion: 0,
      });
    if (change === "epoch")
      await f.db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: 4 },
      });
    if (change === "coverage") {
      const sibling = await f.db.mediaItem.create({
        data: { kind: "movie", title: "Shared coverage changed" },
      });
      await createTestDefaultTarget(f.db, sibling.id);
      await f.db.assetCoverage.create({
        data: { assetId: f.asset.id, mediaId: sibling.id, current: true },
      });
    }
    if (change === "request")
      await new PrismaMediaCommands(f.db, {
        keepDays: 30,
        serverMachineId: "fixture",
      }).cancelRequest(f.member, crypto.randomUUID(), f.claim.id, 0);
    if (change === "access")
      await new PrismaAuthStore(f.db).updateAccess(f.member.id, {
        accountId: f.member.plexAccountId,
        serverMachineId: "fixture",
        permittedMediaKinds: [],
        permittedSectionIds: [],
        plexRestricted: false,
      });
    await expect(
      f.service.release(
        f.owner,
        crypto.randomUUID(),
        review.id,
        releaseInput(ready),
      ),
    ).rejects.toThrow("changed");
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: targetWhere(defaultScope(f.media.id)),
      }),
    ).toMatchObject({ releasedAt: null });
  },
);

test("shared files expand exact coverage; noncanonical root claims and managed self-declarations remain protected", async () => {
  const f = await fixture({ kind: "episode" });
  const physicalSeries = f.series;
  if (physicalSeries === null) throw new Error("Series fixture missing");
  const sibling = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Other episode",
      parentId: physicalSeries.id,
      seasonNumber: 1,
      episodeNumber: 2,
      externalIds: { plexSectionId: "2" },
    },
  });
  await createTestDefaultTarget(f.db, sibling.id, { automationEpoch: 3 });
  await f.db.recoveryHold.create({
    data: {
      mediaId: sibling.id,
      recoveryEpoch: 3,
      reason: "recovery_request_history_unconfirmed",
    },
  });
  await f.db.assetCoverage.create({
    data: { assetId: f.asset.id, mediaId: sibling.id, current: true },
  });
  const review = await f.prepare();
  expect(review.scope.media.map((media) => media.id).sort()).toEqual(
    [f.media.id, sibling.id].sort(),
  );
  const series = await f.db.mediaItem.create({
    data: { kind: "series", title: "Series" },
  });
  const outside = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Outside",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  await createTestDefaultTarget(f.db, series.id);
  await createTestDefaultTarget(f.db, outside.id);
  const root = await f.db.mediaRequest.create({
    data: {
      userId: f.member.id,
      mediaId: series.id,
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
        mediaId: f.media.id,
        requestId: f.claim.id,
        sourceVersion: 0,
      },
      {
        rootRequestId: root.id,
        mediaId: outside.id,
        requestId: outsideClaim.id,
        sourceVersion: 0,
      },
    ],
  });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: { kind: "managed", homeUserId: "9" },
  });
  const protectedReview = await f.prepare();
  expect(protectedReview.scope.blockers).toContain(
    "root_request_coordinates_unconfirmed",
  );
  expect(protectedReview.scope.blockers).not.toContain(
    "partial_root_request_scope",
  );
  await expect(
    f.service.respond(f.member, crypto.randomUUID(), protectedReview.id, {
      scopeHash: protectedReview.scopeHash,
      acknowledgePending: true,
      declarations: protectedReview.scope.media.map((media) => ({
        mediaId: media.id,
        intent: "request",
      })),
    }),
  ).rejects.toThrow("Independent accounts must respond themselves");
});
