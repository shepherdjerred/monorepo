import { expect, test } from "vitest";
import { z } from "zod";
import { recoveryHarness } from "./test-support.ts";
import { isRecoveryScopeV2 } from "#shared/recovery.ts";
import { recoveryView } from "./view.ts";

const { fixture } = recoveryHarness();
test("a member sees only applicable fresh titles and no household roster, excluded pairs or legacy requester identity", async () => {
  const f = await fixture();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.member.id },
    data: {
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      version: { increment: 1 },
    },
  });
  const hidden = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Hidden household episode",
      externalIds: { plexSectionId: "2" },
      intent: { create: { automationEpoch: 3 } },
      recoveryHold: { create: { recoveryEpoch: 3, reason: "fixture" } },
      assets: {
        create: {
          current: true,
          asset: {
            create: {
              path: `/fixture/${crypto.randomUUID()}.mkv`,
              sizeBytes: 100,
              checksum: "b".repeat(64),
              owned: true,
              ownershipEpoch: 3,
              state: "published",
              properties: {},
            },
          },
        },
      },
    },
  });
  const prepared = await f.service.prepare(f.owner, crypto.randomUUID(), {
    mediaIds: [f.media.id, hidden.id],
  });
  const id = z.uuid().parse(prepared.recoveryReviewId);
  const ownerReview = await f.service.detail(f.owner, id);
  expect(ownerReview.scope.blockers).toEqual([]);
  expect(isRecoveryScopeV2(ownerReview.scope)).toBe(true);
  const memberReview = await f.service.detail(f.member, id);
  expect(memberReview.scope.media.map((media) => media.id)).toEqual([
    f.media.id,
  ]);
  expect(memberReview.scope.blockers).toEqual([]);
  const encoded = JSON.stringify(memberReview);
  for (const hiddenValue of [
    hidden.id,
    hidden.title,
    f.owner.id,
    f.asset.checksum,
  ])
    expect(encoded).not.toContain(hiddenValue);
  expect(memberReview.scope).toMatchObject({
    schemaVersion: 2,
    householdRoster: [],
    excludedPairs: [],
    legacyClaims: [],
    requests: [],
    personalHolds: [],
  });
  await expect(
    f.service.respond(f.member, crypto.randomUUID(), id, {
      scopeHash: memberReview.scopeHash,
      acknowledgePending: true,
      declarations: [{ mediaId: hidden.id, intent: "request" }],
    }),
  ).rejects.toThrow();
  await f.service.respond(f.member, crypto.randomUUID(), id, {
    scopeHash: memberReview.scopeHash,
    acknowledgePending: true,
    declarations: [{ mediaId: f.media.id, intent: "request" }],
  });
  const mapped = await f.db.mediaUser.findUniqueOrThrow({
    where: { id: f.member.id },
    include: { plexIdentity: true },
  });
  if (!isRecoveryScopeV2(ownerReview.scope))
    throw new Error("Expected v2 scope");
  const subject = ownerReview.scope.users.find(
    (user) => user.id === f.member.id,
  );
  if (subject === undefined) throw new Error("Expected respondent");
  // Malformed/stale stored acknowledgements cannot disclose a newly hidden ID.
  subject.claimAcknowledgements = [
    {
      provenanceKey: "c".repeat(64),
      captureHash: "d".repeat(64),
      recordDigest: "e".repeat(64),
      bindingId: crypto.randomUUID(),
      bindingRevision: 1,
      latestBindingRevision: 1,
      mediaIds: [f.media.id, hidden.id],
    },
  ];
  const redacted = recoveryView(ownerReview.scope, mapped, "fixture");
  expect(JSON.stringify(redacted)).not.toContain(hidden.id);
});
