import { expect, test } from "vitest";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";

const { fixture } = recoveryHarness();

test("pending declarations preserve protection; exact release applies household intent once without reviving old effect epochs", async () => {
  const f = await fixture();
  const pin = await f.db.retentionHold.create({
    data: { userId: f.owner.id, mediaId: f.media.id, isPin: true },
  });
  const event = await f.db.applicationEvent.create({
    data: { mediaId: f.media.id, kind: "media_available", payload: {} },
  });
  const delivery = await f.db.notificationDelivery.create({
    data: {
      userId: f.member.id,
      channel: "email",
      state: "pending",
      recoveryEpoch: 0,
      eventId: event.id,
    },
  });
  const release = await f.db.releaseCandidate.create({
    data: {
      providerId: "fixture",
      providerReleaseId: crypto.randomUUID(),
      title: "old",
      mediaIds: [f.media.id],
      attributes: {},
      evaluation: {},
    },
  });
  const attempt = await f.db.acquisitionAttempt.create({
    data: {
      releaseId: release.id,
      sponsorRequestId: f.claim.id,
      mediaIds: [f.media.id],
      generations: { [f.media.id]: 1 },
      state: "failed",
      operationId: crypto.randomUUID(),
      recoveryEpoch: 0,
    },
  });
  const initial = await f.prepare();
  await f.service.respond(f.owner, crypto.randomUUID(), initial.id, {
    scopeHash: initial.scopeHash,
    acknowledgePending: true,
    declarations: [{ mediaId: f.media.id, intent: "no_longer_request" }],
  });
  await f.service.respond(f.member, crypto.randomUUID(), initial.id, {
    scopeHash: initial.scopeHash,
    acknowledgePending: true,
    declarations: [{ mediaId: f.media.id, intent: "keep", days: 45 }],
  });
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ releasedAt: null, version: 0 });
  expect(
    await f.db.retentionHold.count({
      where: { userId: f.member.id, mediaId: f.media.id },
    }),
  ).toBe(0);
  const reviewed = await f.service.detail(f.owner, initial.id);
  const key = crypto.randomUUID();
  const receipt = await f.service.release(
    f.owner,
    key,
    initial.id,
    releaseInput(reviewed),
  );
  expect(
    await f.service.release(f.owner, key, initial.id, releaseInput(reviewed)),
  ).toEqual(receipt);
  expect(
    await f.db.recoveryReleaseReceipt.count({
      where: { reviewId: initial.id },
    }),
  ).toBe(1);
  expect(
    await f.db.retentionHold.findUniqueOrThrow({ where: { id: pin.id } }),
  ).toEqual(pin);
  expect(
    await f.db.retentionHold.findUniqueOrThrow({
      where: { userId_mediaId: { userId: f.member.id, mediaId: f.media.id } },
    }),
  ).toMatchObject({ isPin: false });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(attempt);
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    }),
  ).toEqual(delivery);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ automationEpoch: 3, generation: 5 });
});

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
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ releasedAt: null });
  },
);

test("shared files expand exact coverage; root claims outside that scope and managed profiles remain protected", async () => {
  const f = await fixture();
  const sibling = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Other episode",
      externalIds: { plexSectionId: "2" },
      intent: { create: { automationEpoch: 3 } },
      recoveryHold: {
        create: {
          recoveryEpoch: 3,
          reason: "recovery_request_history_unconfirmed",
        },
      },
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
    data: { kind: "episode", title: "Outside" },
  });
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
    "partial_root_request_scope",
  );
  expect(protectedReview.scope.blockers).toContain(
    "household_identity_requires_reconciliation",
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
  ).rejects.toThrow("managed profiles remain protected");
});
