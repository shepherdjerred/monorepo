import { expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  contentRecoveryCatalog,
  contentRecoveryFixture,
} from "#testing/content-recovery-fixture.ts";
import { testOperator } from "#testing/seed.ts";

const scope = useDeliveryFixture({ catalog: contentRecoveryCatalog });

/**
 * A static-site recipe has no Application, so it never recovers through an
 * `argo` intent. landing-pages/prod (2026-11-01) was classified `argo`: the
 * request collided with its pending content intent and answered HTTP 500.
 */
test("a static-site deployment recovers through its content intent, never argo", async () => {
  const { failed, intent } = await contentRecoveryFixture(scope.delivery);
  const detail = await scope.delivery.detail(failed.id);
  const before = await scope.cluster.database.recoveryIntent.count();
  await expect(
    scope.delivery.requestRecoveryIntent(
      failed.id,
      {
        requestId: crypto.randomUUID(),
        reason: "Settle the static publication by Application readback",
        expectedGeneration: detail.environment.generation,
        expectedKind: "argo",
      },
      testOperator,
    ),
  ).rejects.toThrow(`recovers through a content intent, not argo`);
  expect(await scope.cluster.database.recoveryIntent.count()).toBe(before);
  expect(
    await scope.cluster.database.recoveryIntent.findUniqueOrThrow({
      where: { id: intent.id },
    }),
  ).toMatchObject({ kind: "content", status: "pending" });
});
