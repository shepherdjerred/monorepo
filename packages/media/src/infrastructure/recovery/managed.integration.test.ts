import { expect, test } from "vitest";
import { z } from "zod";
import { Hono } from "hono";
import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";
import { registerRecoveryRoutes } from "#server/recovery-routes.ts";
import {
  isRecoveryScopeV2,
  RecoveryStoredResponseSchema,
} from "#shared/recovery.ts";
import { recoveryHarness, releaseInput } from "./test-support.ts";

const { fixture } = recoveryHarness();
test("current owner declares exact managed demand with distinct attribution; ordinary and managed self impersonation reject", async () => {
  const f = await fixture();
  const ordinary = await f.prepare();
  await expect(
    f.service.respond(f.owner, crypto.randomUUID(), ordinary.id, {
      scopeHash: ordinary.scopeHash,
      subjectUserId: f.member.id,
      acknowledgePending: true,
      declarations: [{ mediaId: f.media.id, intent: "request" }],
    }),
  ).rejects.toMatchObject({ code: "recovery_respondent_forbidden" });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: {
      kind: "managed",
      homeUserId: "managed-200",
      plexRestricted: true,
      version: { increment: 1 },
    },
  });
  const review = await f.prepare();
  expect(review.scope.blockers).toEqual([]);
  const data = {
    scopeHash: review.scopeHash,
    acknowledgePending: true as const,
    declarations: [{ mediaId: f.media.id, intent: "keep" as const, days: 45 }],
  };
  await expect(
    f.service.respond(f.member, crypto.randomUUID(), review.id, data),
  ).rejects.toMatchObject({ code: "recovery_respondent_forbidden" });
  await f.service.respond(f.owner, crypto.randomUUID(), review.id, {
    ...data,
    subjectUserId: f.member.id,
  });
  await f.service.respond(f.owner, crypto.randomUUID(), review.id, {
    ...data,
    declarations: [{ mediaId: f.media.id, intent: "no_longer_request" }],
  });
  const response = await f.db.recoveryResponse.findUniqueOrThrow({
    where: { reviewId_userId: { reviewId: review.id, userId: f.member.id } },
  });
  expect(response.actorId).toBe(f.owner.id);
  expect(response.userId).toBe(f.member.id);
  expect(RecoveryStoredResponseSchema.parse(response.response)).toMatchObject({
    schemaVersion: 2,
    authority: {
      mode: "managed_owner",
      actorId: f.owner.id,
      subjectUserId: f.member.id,
    },
  });
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId: f.media.id },
    }),
  ).toMatchObject({ releasedAt: null });
  const ready = await f.service.detail(f.owner, review.id);
  await f.service.release(
    f.owner,
    crypto.randomUUID(),
    review.id,
    releaseInput(ready),
  );
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: { userId_mediaId: { userId: f.member.id, mediaId: f.media.id } },
    }),
  ).toMatchObject({ active: true, excluded: false });
  expect(
    await f.db.retentionHold.findUniqueOrThrow({
      where: { userId_mediaId: { userId: f.member.id, mediaId: f.media.id } },
    }),
  ).toMatchObject({ isPin: false });
});

test.each(["restriction", "mapping"])(
  "managed declaration cannot release after current %s changes",
  async (change) => {
    const f = await fixture();
    await f.db.plexIdentityMapping.update({
      where: { userId: f.member.id },
      data: {
        kind: "managed",
        homeUserId: "managed-200",
        plexRestricted: true,
      },
    });
    const review = await f.prepare();
    for (const subjectUserId of [f.member.id, f.owner.id])
      await f.service.respond(f.owner, crypto.randomUUID(), review.id, {
        scopeHash: review.scopeHash,
        subjectUserId,
        acknowledgePending: true,
        declarations: [{ mediaId: f.media.id, intent: "request" }],
      });
    const ready = await f.service.detail(f.owner, review.id);
    if (change === "restriction")
      await f.db.mediaUser.update({
        where: { id: f.owner.id },
        data: { restricted: true },
      });
    else
      await f.db.plexIdentityMapping.update({
        where: { userId: f.member.id },
        data: { homeUserId: "different-profile", version: { increment: 1 } },
      });
    await expect(
      f.service.release(
        f.owner,
        crypto.randomUUID(),
        review.id,
        releaseInput(ready),
      ),
    ).rejects.toBeInstanceOf(MediaError);
    expect(
      await f.db.recoveryReleaseReceipt.count({
        where: { reviewId: review.id },
      }),
    ).toBe(0);
    expect(
      await f.db.recoveryHold.findUniqueOrThrow({
        where: { mediaId: f.media.id },
      }),
    ).toMatchObject({ releasedAt: null });
  },
);

test("disjoint current libraries require per-person leaves and member HTTP cannot reveal the hidden title or forged authority", async () => {
  const f = await fixture();
  await f.db.mediaRequest.update({
    where: { id: f.claim.id },
    data: { userId: f.owner.id },
  });
  const tv = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Member-only episode",
      externalIds: { plexSectionId: "2" },
      availability: "available",
      intent: { create: { automationEpoch: 3 } },
      recoveryHold: {
        create: {
          recoveryEpoch: 3,
          reason: "recovery_request_history_unconfirmed",
        },
      },
    },
  });
  await f.db.libraryAsset.create({
    data: {
      path: `/fixture/${tv.id}.mkv`,
      sizeBytes: 100,
      checksum: "b".repeat(64),
      owned: true,
      ownershipEpoch: 3,
      state: "published",
      properties: {},
      coverage: { create: { mediaId: tv.id, current: true } },
    },
  });
  for (const [userId, section, kind] of [
    [f.owner.id, "1", "movie"],
    [f.member.id, "2", "series"],
  ]) {
    await f.db.plexIdentityMapping.update({
      where: { userId: z.string().parse(userId) },
      data: {
        permittedSectionIds: [z.string().parse(section)],
        permittedMediaKinds: [z.string().parse(kind)],
      },
    });
  }
  const prepared = await f.service.prepare(f.owner, crypto.randomUUID(), {
    mediaIds: [f.media.id, tv.id],
  });
  const review = await f.service.detail(
    f.owner,
    z.uuid().parse(prepared.recoveryReviewId),
  );
  expect(review.scope.blockers).toEqual([]);
  expect(isRecoveryScopeV2(review.scope)).toBe(true);
  const app = new Hono<{
    Variables: { actor: MediaActor; requestId: string };
  }>();
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof MediaError ? error.status : 500,
    ),
  );
  app.use("*", async (c, next) => {
    c.set("actor", f.member);
    c.set("requestId", "fixture");
    await next();
  });
  registerRecoveryRoutes(app, f.service);
  const detail = await app.request(`/api/v1/recovery/reviews/${review.id}`);
  expect(detail.status).toBe(200);
  const body = await detail.text();
  expect(body).toContain(tv.title);
  expect(body).not.toContain(f.media.title);
  expect(body).not.toContain(f.media.id);
  expect(body).not.toContain(f.owner.id);
  const forged = await app.request(
    `/api/v1/recovery/reviews/${review.id}/responses`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        scopeHash: review.scopeHash,
        acknowledgePending: true,
        declarations: [{ mediaId: tv.id, intent: "request" }],
        authority: {
          mode: "managed_owner",
          actorId: f.owner.id,
          mappingVersion: 0,
        },
      }),
    },
  );
  expect(forged.status).toBe(400);
  for (const [actor, mediaId] of [
    [f.owner, f.media.id],
    [f.member, tv.id],
  ] as const)
    await f.service.respond(actor, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId, intent: "request" }],
    });
  await f.service.release(
    f.owner,
    crypto.randomUUID(),
    review.id,
    releaseInput(await f.service.detail(f.owner, review.id)),
  );
  expect(
    await f.db.recoveryHold.count({
      where: { mediaId: { in: [f.media.id, tv.id] }, releasedAt: null },
    }),
  ).toBe(0);
});
