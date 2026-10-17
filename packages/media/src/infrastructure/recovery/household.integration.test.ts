import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { recoveryHarness, releaseInput } from "./test-support.ts";
import { createTestDefaultTarget } from "#testing/editions.ts";

const { fixture } = recoveryHarness();
test("owner authority status remains visible with no household holds and is redacted from members", async () => {
  const f = await fixture();
  await f.db.recoveryHold.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { releasedAt: new Date() },
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", ownershipConfirmed: false },
  });
  await f.db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { revokedAt: new Date() },
  });
  const owner = await f.service.list(f.owner);
  expect(owner.holds).toEqual([]);
  expect(owner.authority).toEqual({
    mode: "observe",
    ownershipConfirmed: false,
    writerState: "revoked",
    storageState: "missing",
  });
  const member = await f.service.list(f.member);
  expect(member.authority).toBeNull();
  await f.db.legacyWriterLease.update({
    where: { id: "singleton" },
    data: { revokedAt: null, observedAt: new Date(0), expiresAt: new Date(1) },
  });
  const expired = await f.service.list(f.owner);
  expect(expired.authority?.writerState).toBe("stale");
});

test("an ancestor request protects episodes before any coverage projection exists", async () => {
  const f = await fixture({ kind: "episode", nestedSeason: true });
  const series = f.series;
  if (series === null) throw new Error("Series fixture missing");
  await createTestDefaultTarget(f.db, series.id);
  const root = await f.db.mediaRequest.create({
    data: {
      mediaId: series.id,
      userId: f.member.id,
      active: true,
      coverageCompletedAt: null,
    },
  });
  expect(
    await f.db.requestCoverage.count({ where: { rootRequestId: root.id } }),
  ).toBe(0);
  const review = await f.prepare();
  expect(review.scope.blockers).toContain("root_request_projection_incomplete");
  expect(review.scope.requests).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: root.id })]),
  );
});

test("a freshly denied unrelated managed profile does not block the adult library; unknown access and relevant old claims still protect", async () => {
  const f = await fixture();
  const kid = await f.db.mediaUser.create({
    data: {
      plexAccountId: "300",
      displayName: "Kids-only profile",
      restricted: true,
      plexIdentity: {
        create: {
          kind: "managed",
          serverMachineId: "fixture",
          homeUserId: "300",
          permittedSectionIds: ["kids"],
          permittedMediaKinds: ["movie"],
          verifiedAt: new Date(),
        },
      },
    },
  });
  const first = await f.prepare();
  expect(first.scope.users.map((user) => user.id)).not.toContain(kid.id);
  expect(first.scope.excludedUsers).toMatchObject([
    { id: kid.id, reason: "fresh_scope_denial_without_relevant_claim" },
  ]);
  expect(first.scope.blockers).toEqual([]);
  const ready = await f.responses(first.id);
  await f.service.release(
    f.owner,
    crypto.randomUUID(),
    first.id,
    releaseInput(ready),
  );
  // A later new system hold must not inherit the previous declaration receipt.
  await f.db.recoveryHold.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { releasedAt: null, releasedById: null, version: { increment: 1 } },
  });
  await f.db.plexIdentityMapping.update({
    where: { userId: kid.id },
    data: { verifiedAt: null },
  });
  const unknown = await f.prepare();
  expect(unknown.scope.users.map((user) => user.id)).toContain(kid.id);
  expect(unknown.scope.blockers).toContain(
    "household_identity_requires_reconciliation",
  );
  await f.db.plexIdentityMapping.update({
    where: { userId: kid.id },
    data: { verifiedAt: new Date() },
  });
  await f.db.mediaRequest.create({
    data: {
      userId: kid.id,
      mediaId: f.media.id,
      active: false,
      excluded: true,
    },
  });
  const historical = await f.prepare();
  expect(historical.scope.users.map((user) => user.id)).toContain(kid.id);
  expect(historical.scope.blockers).toContain(
    "household_identity_requires_reconciliation",
  );
});
