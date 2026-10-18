import { expect, test, vi } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  contentRecoveryFixture,
  contentBarrier,
  contentObservation,
  contentRecoveryCatalog,
} from "#testing/content-recovery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";
import { lock } from "#infrastructure/delivery-records.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });

test("prior settlement binds frozen configuration even when the same version was genuinely accepted under another configuration", async () => {
  const fixture = await contentRecoveryFixture(scope.delivery, {
    site: "reviewed-second-configuration",
  });
  const failed = await scope.delivery.detail(fixture.failed.id);
  // Timestamp order is not an identity: simulate a later timestamp on the
  // genuinely accepted first incarnation without altering its frozen config.
  await scope.cluster.database.deployment.update({
    where: { id: fixture.firstAccepted.id },
    data: { finishedAt: new Date(failed.deployment.createdAt) },
  });
  const context = await scope.delivery.contentRecovery(
    fixture.intent.id,
    testExecutor,
  );
  expect(context.priorDeployment?.deployment.id).toBe(fixture.accepted.id);
  expect(context.priorDeployment?.deployment.configuration).toEqual(
    failed.deployment.previousAcceptedConfiguration,
  );
});

test("evidence expiring while waiting for the actual PG ownership lock cannot settle quarantine", async () => {
  const fixture = await contentRecoveryFixture(scope.delivery);
  await scope.delivery.recordContentRecoveryBarrier(
    fixture.intent.id,
    contentBarrier,
    testExecutor,
  );
  const context = await scope.delivery.contentRecovery(
    fixture.intent.id,
    testExecutor,
  );
  const proof = {
    ...contentObservation(context),
    settlement: {
      state: "desired" as const,
      fingerprint: context.expectedSettlements.desired,
    },
    proofSummary:
      "Independent exact static bytes were read before waiting for the target transaction",
  };
  const held = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>();
  const holder = scope.cluster.database.$transaction(
    async (tx) => {
      await lock(tx, "delivery:claim");
      held.resolve(undefined);
      await release.promise;
    },
    { timeout: 10_000 },
  );
  await held.promise;
  const result = (async () => {
    try {
      return {
        value: await scope.delivery.completeContentRecovery(
          fixture.intent.id,
          proof,
          testExecutor,
        ),
        error: null,
      };
    } catch (error: unknown) {
      return { value: null, error };
    }
  })();
  try {
    let waiting = false;
    for (let attempt = 0; !waiting && attempt < 100; attempt++) {
      const rows = await scope.cluster.database.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`;
      waiting = rows[0]?.count === 1;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(waiting).toBe(true);
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse(proof.observedAt) + 61_000);
    try {
      release.resolve(undefined);
      await holder;
      const settled = await result;
      expect(settled.error).toMatchObject({ code: "CONFLICT" });
    } finally {
      clock.mockRestore();
    }
  } finally {
    release.resolve(undefined);
    await holder;
  }
  const after = await scope.delivery.detail(fixture.failed.id);
  expect(after.deployment.recoveryRequired).toBe(true);
  expect(after.environment.activeDeploymentId).toBe(fixture.failed.id);
});
