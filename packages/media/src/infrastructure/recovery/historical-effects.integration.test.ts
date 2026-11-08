import { beforeAll, afterAll, expect, test } from "vitest";
import { z } from "zod";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { releaseInput } from "./test-support.ts";
import {
  historicalEffectsFixture,
  originalAttemptJson,
} from "./historical-effects-fixture.ts";

let fixture: Awaited<ReturnType<typeof historicalEffectsFixture>> | undefined;
beforeAll(async () => {
  fixture = await historicalEffectsFixture();
}, 60_000);
afterAll(async () => {
  await fixture?.close();
});

test("pending declarations preserve protection; exact release applies household intent once without reviving old effect epochs", async () => {
  if (fixture === undefined)
    throw new Error("Historical recovery fixture missing");
  const f = fixture;
  const { pin, delivery, attempt } = f;
  expect(f.media.kind).toBe("movie");
  expect(f.afterMigration).toBe(f.beforeMigration);
  expect(f.migratedClaim).toEqual(f.claim);
  expect(attempt).toMatchObject({
    ...f.originalAttempt,
    recoveryEpoch: 0,
    generations: { [f.media.id]: 1 },
    identityEvidence: null,
    movieEditionChoiceId: null,
    movieEditionChoiceRevision: null,
    movieEditionAuthority: null,
  });
  expect(await f.db.movieEditionChoice.count()).toBe(0);
  const prepared = await f.service.prepare(f.owner, crypto.randomUUID(), {
    mediaIds: [f.media.id],
  });
  const initial = await f.service.detail(
    f.owner,
    z.uuid().parse(prepared.recoveryReviewId),
  );
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
      where: targetWhere(defaultScope(f.media.id)),
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
      where: {
        userId_mediaId_edition: {
          edition: "default",
          userId: f.member.id,
          mediaId: f.media.id,
        },
      },
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
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ automationEpoch: 3, generation: 5 });
  expect(await originalAttemptJson(f.db, attempt.id)).toBe(f.beforeMigration);
  expect(await f.db.movieEditionChoice.count()).toBe(0);
});
