import { expect, test } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "#infrastructure/database.ts";
import { legacyClaimsHarness } from "./test-fixture.ts";
import { lockLegacyRequesterBindings } from "./bindings.ts";
const harness = legacyClaimsHarness();

async function waitForLock(db: Database, fragment: string) {
  for (let count = 0; count < 100; count++) {
    const rows = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${fragment}%`}`;
    if (rows.some((row) => row.count > 0n)) return;
    await delay(10);
  }
  throw new Error("Fixture never reached the required PostgreSQL lock wait");
}

test("owner demotion while binding waits for identity locks revokes the declaration atomically", async () => {
  const f = await harness.setup();
  const source = await f.capture();
  const view = await f.service.list(f.owner, source.captureId);
  const requester = view.requesters[0];
  if (requester === undefined) throw new Error("Fixture requester missing");
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const mutation = f.db.$transaction(async (tx) => {
    await tx.mediaUser.update({
      where: { id: f.owner.id },
      data: { role: "member", version: { increment: 1 } },
    });
    entered.resolve(undefined);
    await resume.promise;
  });
  await entered.promise;
  const pending = observeResult(
    f.service.bind(f.owner, crypto.randomUUID(), {
      captureId: source.captureId,
      requesterSourceId: requester.requesterSourceId,
      requesterEvidenceHash: requester.requesterEvidenceHash,
      userId: f.subject.id,
      expectedRevision: 0,
      acknowledgeIdentityOnly: true,
    }),
  );
  try {
    await waitForLock(f.db, "MediaUser");
  } finally {
    resume.resolve(undefined);
  }
  await mutation;
  expect(await pending).toMatchObject({ code: "owner_required" });
  expect(
    await f.db.legacyRequesterBinding.count({
      where: { captureId: source.captureId },
    }),
  ).toBe(0);
});

test("new immutable captures serialize against household claim snapshots instead of appearing after the final check", async () => {
  const f = await harness.setup();
  const first = await f.capture();
  await f.bind(first.captureId);
  const entered = Promise.withResolvers<undefined>();
  const resume = Promise.withResolvers<undefined>();
  const review = f.db.$transaction(async (tx) => {
    await lockLegacyRequesterBindings(tx);
    entered.resolve(undefined);
    await resume.promise;
  });
  await entered.promise;
  const pending = f.capture();
  try {
    await waitForLock(f.db, "pg_advisory_xact_lock");
    expect(
      await f.db.migrationCapture.count({
        where: { sourceInstanceId: f.instance },
      }),
    ).toBe(1);
  } finally {
    resume.resolve(undefined);
  }
  await review;
  await pending;
  const changed = await f.project([f.movie.id]);
  expect(changed.blockers).toContain("legacy_claim_requester_unmapped");
});

async function observeResult(work: Promise<unknown>) {
  try {
    return await work;
  } catch (error) {
    return error;
  }
}
