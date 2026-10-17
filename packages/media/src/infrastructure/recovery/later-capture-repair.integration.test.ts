import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";
import { expect, test } from "vitest";
import { z } from "zod";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { RecoveryScopeV2Schema } from "#shared/recovery.ts";
import { legacyLifecycleHarness } from "./legacy-claims/lifecycle-fixture.ts";
import { buildRecoveryClaims } from "./legacy-claims/projection.ts";
import {
  LEGACY_CLAIM_PROTECTION,
  reopenLegacyClaimProtection,
} from "./legacy-claims/protection.ts";
import { releaseInput } from "./test-support.ts";

const harness = legacyLifecycleHarness();
type Fixture = Awaited<ReturnType<typeof harness.fixture>>;

async function preservePersonalState(f: Fixture) {
  const pin = await f.db.retentionHold.create({
    data: { userId: f.owner.id, mediaId: f.media.id, isPin: true },
  });
  const media = await f.db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Outside the selected recovery",
      externalIds: {},
    },
  });
  await createTestDefaultTarget(f.db, media.id, {
    automationEpoch: 0,
    generation: 19,
  });
  await f.db.mediaRequest.create({
    data: { mediaId: media.id, userId: f.user.id, active: true },
  });
  await f.db.retentionHold.create({
    data: { mediaId: media.id, userId: f.owner.id, isPin: true },
  });
  const outside = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: media.id },
    include: {
      intents: { where: { edition: "default" } },
      requests: { where: { edition: "default" } },
      holds: { where: { edition: "default" } },
    },
  });
  return { pin, outside };
}

async function declareFresh(f: Fixture, reviewId: string, positive: boolean) {
  const review = await f.recovery.detail(f.owner, reviewId);
  const scope = RecoveryScopeV2Schema.parse(review.scope);
  expect(scope.blockers).toEqual([]);
  expect(scope.legacyClaims).toHaveLength(1);
  for (const subject of scope.users) {
    const actor = await f.db.mediaUser.findUniqueOrThrow({
      where: { id: subject.id },
    });
    await f.recovery.respond(actor, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      claimAcknowledgements: subject.claimAcknowledgements,
      declarations: subject.applicableMediaIds.map((mediaId) => ({
        mediaId,
        intent:
          positive && actor.id === f.user.id ? "request" : "no_longer_request",
      })),
    });
  }
  return f.recovery.detail(f.owner, review.id);
}

test.each([
  { mapped: false, quarantined: false, positive: true },
  { mapped: true, quarantined: false, positive: false },
  { mapped: false, quarantined: true, positive: true },
  { mapped: true, quarantined: true, positive: false },
])(
  "late capture repair is discoverable and exactly releasable: %j",
  async ({ mapped, quarantined, positive }) => {
    const f = await harness.fixture();
    if (quarantined)
      expect(
        await createMediaFileActivities(f.context).quarantineMediaFiles(
          f.retention.input,
        ),
      ).toEqual({ status: "quarantined" });
    const before = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: f.retention.decision.id },
    });
    const warning = await f.db.notificationDelivery.findFirstOrThrow({
      where: {
        eventId: z.object({ warningEventId: z.string() }).parse(before.evidence)
          .warningEventId,
      },
    });
    expect(warning.state).toBe("accepted");
    const personal = await preservePersonalState(f);
    const captureId = await f.capture(mapped);
    const pending = await buildRecoveryClaims(f.db, {
      planIds: [],
      mediaIds: [f.media.id],
    });
    if (mapped) {
      expect(pending.blockers).toEqual([]);
      expect(pending.claims).toHaveLength(1);
    } else
      expect(pending.blockers).toContain("legacy_claim_requester_unmapped");
    expect(await reopenLegacyClaimProtection(f.db, [f.media.id])).toBe(true);
    const listing = await f.recovery.list(f.owner);
    expect(listing.holds).toContainEqual({
      mediaId: f.media.id,
      title: f.media.title,
      reason: LEGACY_CLAIM_PROTECTION,
    });
    expect(
      listing.holds.some((hold) => hold.mediaId === personal.outside.id),
    ).toBe(false);
    const repaired = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(repaired).toMatchObject({
      state: quarantined ? "quarantined" : "cancelled",
      warningAcceptedAt: null,
      graceUntil: null,
      manifest: before.manifest,
      purgeAfter: before.purgeAfter,
    });
    if (!mapped) {
      const blocked = await f.recovery.prepare(f.owner, crypto.randomUUID(), {
        mediaIds: [f.media.id],
      });
      const detail = await f.recovery.detail(
        f.owner,
        z.uuid().parse(blocked.recoveryReviewId),
      );
      expect(detail.scope.blockers).toContain(
        "legacy_claim_requester_unmapped",
      );
      await f.bind(captureId);
    }
    const prepared = await f.recovery.prepare(f.owner, crypto.randomUUID(), {
      mediaIds: [f.media.id],
    });
    const reviewId = z.uuid().parse(prepared.recoveryReviewId);
    const ready = await declareFresh(f, reviewId, positive);
    const result = await f.recovery.release(
      f.owner,
      crypto.randomUUID(),
      reviewId,
      releaseInput(ready),
    );
    const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.recoveryReceiptId) },
    });
    expect(receipt.claimAccounting).toMatchObject([
      { captureId, userId: f.user.id, mediaIds: [f.media.id] },
    ]);
    expect(
      await buildRecoveryClaims(f.db, { planIds: [], mediaIds: [f.media.id] }),
    ).toMatchObject({ claims: [], blockers: [] });
    expect(await reopenLegacyClaimProtection(f.db, [f.media.id])).toBe(false);
    const afterRelease = await f.recovery.list(f.owner);
    expect(afterRelease.holds.some((hold) => hold.mediaId === f.media.id)).toBe(
      false,
    );
    expect(
      await f.db.retentionHold.findUniqueOrThrow({
        where: { id: personal.pin.id },
      }),
    ).toEqual(personal.pin);
    expect(
      await f.db.mediaItem.findUniqueOrThrow({
        where: { id: personal.outside.id },
        include: {
          intents: { where: { edition: "default" } },
          requests: { where: { edition: "default" } },
          holds: { where: { edition: "default" } },
        },
      }),
    ).toEqual(personal.outside);
    const intent = await f.db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    });
    expect(intent.generation).toBeGreaterThan(before.generation);
    const old = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(old.warningAcceptedAt).toBeNull();
    expect(old.graceUntil).toBeNull();
    expect(old.manifest).toEqual(before.manifest);
    // Provider acceptance is historical evidence; its old decision/generation is no longer authority.
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: warning.id },
      }),
    ).toEqual(warning);
    const queued = await f.db.operation.findMany({
      where: { idempotencyKey: `recovery-restore:${reviewId}:${f.media.id}` },
      include: { outbox: true },
    });
    expect(queued).toHaveLength(positive ? 1 : 0);
    if (positive)
      expect(queued[0]).toMatchObject({
        kind: quarantined ? "restore_media" : "reconcile_media",
        payload: {
          mediaId: f.media.id,
          generation: intent.generation,
          recoveryEpoch: 0,
        },
        outbox: { kind: quarantined ? "restore_media" : "reconcile_media" },
      });
    expect(
      await f.db.operation.count({
        where: {
          targetId: f.media.id,
          kind: { in: ["purge_media", "retain_media"] },
        },
      }),
    ).toBe(0);
  },
);
