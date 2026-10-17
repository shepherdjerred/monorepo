import { expect, test } from "vitest";
import { z } from "zod";
import {
  recoveryHarness,
  releaseInput,
} from "#infrastructure/recovery/test-support.ts";
import { PrismaMigrationAdministration } from "#migration/persistence.ts";
import { recordDigest } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { RecoveryScopeV2Schema } from "#shared/recovery.ts";
import type { MigrationRecord } from "#shared/migration.ts";
import { PrismaLegacyRequesterBindings } from "./service.ts";
import { buildRecoveryClaims } from "./projection.ts";

const harness = recoveryHarness();
async function fixture() {
  const f = await harness.fixture();
  const tmdbId =
    (Number(crypto.getRandomValues(new Uint32Array(1))[0]) % 2_000_000_000) + 1;
  await f.db.mediaItem.update({ where: { id: f.media.id }, data: { tmdbId } });
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: { serverAccountId: "200" },
  });
  const request: MigrationRecord = {
    kind: "request",
    sourceId: "review-request",
    requesterSourceId: "7",
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: { tmdb: tmdbId },
    scope: "movie",
    seasons: [],
    active: true,
  };
  const timestamp = new Date().toISOString();
  const uploaded = await new PrismaMigrationAdministration(f.db).upload(
    f.owner,
    {
      snapshot: {
        schemaVersion: 1,
        sourceInstanceId: snapshotHash(crypto.randomUUID()),
        sourceKind: "seerr",
        sourceVersion: "3.0.0",
        startedAt: timestamp,
        completedAt: timestamp,
        records: [request],
        endpoints: [
          {
            name: "requests",
            pages: 1,
            records: 1,
            complete: true,
            stable: true,
            digest: recordDigest([request]),
            reason: "complete",
          },
        ],
      },
    },
  );
  const bindings = new PrismaLegacyRequesterBindings(f.db, "fixture");
  const listed = await bindings.list(f.owner, uploaded.captureId);
  const source = listed.requesters[0];
  if (source === undefined) throw new Error("Missing fixture requester");
  const bindInput = {
    captureId: uploaded.captureId,
    requesterSourceId: source.requesterSourceId,
    requesterEvidenceHash: source.requesterEvidenceHash,
    userId: f.member.id,
    expectedRevision: 0,
    acknowledgeIdentityOnly: true as const,
  };
  await bindings.bind(f.owner, crypto.randomUUID(), bindInput);
  return { ...f, bindings, bindInput };
}

test("actual household self-declaration and owner release commits only exact acknowledged capture accounting", async () => {
  const f = await fixture();
  const review = await f.prepare();
  const scope = RecoveryScopeV2Schema.parse(review.scope);
  expect(scope.blockers).toEqual([]);
  expect(scope.legacyClaims).toHaveLength(1);
  await expect(
    f.service.respond(f.member, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: f.media.id, intent: "request" }],
    }),
  ).rejects.toThrow("Acknowledge the exact selected legacy claims");
  for (const actor of [f.owner, f.member]) {
    const subject = scope.users.find((user) => user.id === actor.id);
    if (subject === undefined) throw new Error("Respondent missing");
    await f.service.respond(actor, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      claimAcknowledgements: subject.claimAcknowledgements,
      declarations: [{ mediaId: f.media.id, intent: "request" }],
    });
  }
  const ready = await f.service.detail(f.owner, review.id);
  const result = await f.service.release(
    f.owner,
    crypto.randomUUID(),
    review.id,
    releaseInput(ready),
  );
  const receipt = await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.recoveryReceiptId) },
  });
  expect(receipt.claimAccounting).toMatchObject([
    {
      captureId: f.bindInput.captureId,
      userId: f.member.id,
      mediaIds: [f.media.id],
    },
  ]);
  const remaining = await buildRecoveryClaims(f.db, {
    planIds: [],
    mediaIds: [f.media.id],
  });
  expect(remaining.claims).toEqual([]);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).not.toMatchObject({ releasedAt: null });
});

test("a fresh owner binding revision invalidates an actual pending review before any household response is accepted", async () => {
  const f = await fixture();
  const review = await f.prepare();
  await f.bindings.bind(f.owner, crypto.randomUUID(), {
    ...f.bindInput,
    expectedRevision: 1,
  });
  await expect(
    f.service.respond(f.owner, crypto.randomUUID(), review.id, {
      scopeHash: review.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: f.media.id, intent: "request" }],
    }),
  ).rejects.toThrow("prepare a fresh review");
  expect(
    await f.db.recoveryResponse.count({ where: { reviewId: review.id } }),
  ).toBe(0);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toMatchObject({ releasedAt: null });
});
