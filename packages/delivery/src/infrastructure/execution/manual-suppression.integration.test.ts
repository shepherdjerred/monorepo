import { describe, expect, test } from "vitest";
import {
  acceptedDeployment,
  useDeliveryFixture,
} from "#testing/delivery-fixture.ts";
import { testExecutor } from "#testing/seed.ts";

const context = useDeliveryFixture();

async function environmentRow() {
  return context.cluster.database.environment.findUniqueOrThrow({
    where: { id: context.fixture.environment.id },
  });
}

function acceptManual(versionSetId: string) {
  return acceptedDeployment(context, versionSetId);
}

/**
 * A set revision of arcade over the seed's entries: a tracking
 * recomposition (R7) when it names a trigger, a manual hotfix (R3) when not.
 */
async function composedSet(
  revision: number,
  origin: { triggerDeploymentId: string; orderMinor: number } | "manual",
) {
  const db = context.cluster.database;
  const seed = await db.versionSet.findUniqueOrThrow({
    where: { id: context.fixture.versionSet.id },
    include: { entries: true },
  });
  return db.versionSet.create({
    data: {
      id: `arcade/set-${String(revision)}`,
      serviceId: "arcade",
      revision,
      lineage: seed.lineage,
      ...(origin === "manual"
        ? {}
        : {
            automatic: true,
            triggerDeploymentId: origin.triggerDeploymentId,
            baseRevisionId: seed.id,
            orderMajor: seed.orderMajor,
            orderMinor: origin.orderMinor,
          }),
      entries: {
        create: seed.entries.map(({ component, artifactId }) => ({
          component,
          artifactId,
        })),
      },
    },
  });
}

async function automaticRequests() {
  const { deployments } = await context.delivery.reconcile(
    [context.fixture.environment.id],
    testExecutor,
  );
  const details = await Promise.all(
    deployments.map(async (id) => context.delivery.detail(id)),
  );
  return details.map((detail) => detail.deployment);
}

describe("manual selection suppression (D3, R7)", () => {
  test("an accepted manual selection suppresses tracking sets newer than the last qualified build", async () => {
    const seed = await context.cluster.database.versionSet.findUniqueOrThrow({
      where: { id: context.fixture.versionSet.id },
    });
    const baseline = await acceptManual(seed.id);
    // Tracking recompositions order after the qualified live set (R7).
    const orderMinor = (seed.orderMinor ?? 0) + 100;
    await composedSet(seed.revision + 1, {
      triggerDeploymentId: baseline.id,
      orderMinor,
    });
    const newestTracking = await composedSet(seed.revision + 2, {
      triggerDeploymentId: baseline.id,
      orderMinor: orderMinor + 1,
    });
    const hotfix = await composedSet(seed.revision + 3, "manual");

    await acceptManual(hotfix.id);

    const env = await environmentRow();
    expect(env.acceptedVersionSetRevisionId).toBe(hotfix.id);
    expect(env.automaticSuppressedThroughRevision).toBe(
      newestTracking.revision,
    );
    // The older tracking set never reverts the operator's selection.
    expect(await automaticRequests()).toEqual([]);

    // A set revision composed after the acceptance still deploys.
    await context.publishVerified(2);
    const composed = await context.cluster.database.versionSet.findFirstOrThrow(
      {
        where: { serviceId: "arcade", automatic: true },
        orderBy: { revision: "desc" },
      },
    );
    expect(composed.revision).toBeGreaterThan(hotfix.revision);
    expect(await automaticRequests()).toEqual([
      expect.objectContaining({
        automatic: true,
        versionSetRevisionId: composed.id,
      }),
    ]);
  });

  test("an accepted manual selection never lowers an existing suppression", async () => {
    await context.cluster.database.environment.update({
      where: { id: context.fixture.environment.id },
      data: { automaticSuppressedThroughRevision: 50 },
    });
    await acceptManual(context.fixture.versionSet.id);
    const env = await environmentRow();
    expect(env.automaticSuppressedThroughRevision).toBe(50);
  });
});
