import { rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { archivePublicationTransitionFixture } from "#infrastructure/native-archive/publication-transition.test-support.ts";
import { prepareArchiveRenewal } from "#infrastructure/native-archive/renewal.test-support.ts";
import { NativeArchiveScopeSchema } from "#shared/native-recovery/archive.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { proofQueryAudit } from "#infrastructure/plex-binding/native/query-budget.test-support.ts";
import {
  lockNativeArchiveScope,
  assertNativeArchiveSnapshot,
} from "#infrastructure/native-archive/guards.ts";
import * as archiveSupersession from "#infrastructure/native-archive/supersession.ts";
import type { Prisma } from "#generated/prisma/client.ts";

const harness = automationTestHarness();
let fixture: Awaited<ReturnType<typeof archivePublicationTransitionFixture>>;
let prepared: Awaited<ReturnType<typeof prepareArchiveRenewal>>;
let activity: { planId: string; operationId: string; planHash: string };

beforeAll(async () => {
  const db = harness.database();
  fixture = await archivePublicationTransitionFixture(
    db,
    harness.context().cipher,
    harness.context(),
    { stopOldCleanup: "allocated" },
  );
  prepared = await prepareArchiveRenewal(
    db,
    fixture,
    fixture.oldCleanups.map((row) => row.id),
  );
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: prepared.input.planId },
  });
  const command = await fixture.service.apply(
    fixture.prior.actor,
    crypto.randomUUID(),
    plan.id,
    {
      expectedVersion: plan.version,
      planHash: z.string().parse(plan.planHash),
      recoveryEpoch: plan.recoveryEpoch,
      runtimeVersion: plan.runtimeVersion,
      acknowledgePhysicalOwnershipOnly: true,
      acknowledgeRecoveryHolds: true,
      acknowledgeSubtitlePolicies: true,
    },
  );
  activity = {
    planId: plan.id,
    operationId: z.uuid().parse(command.operationId),
    planHash: z.string().parse(plan.planHash),
  };
}, 60_000);
afterAll(async () => {
  if (fixture !== undefined)
    await rm(fixture.file.directory, { recursive: true, force: true });
});

async function snapshot(
  tx: Prisma.TransactionClient,
  budget: PublicationAuthorityReadBudget,
) {
  const plan = await tx.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: activity.planId },
  });
  const scope = NativeArchiveScopeSchema.parse(plan.scope);
  await lockNativeArchiveScope(tx, scope);
  await tx.$queryRaw`SELECT id FROM "NativeRecoveryPlan" WHERE id=${activity.planId} FOR UPDATE`;
  return assertNativeArchiveSnapshot(tx, activity.planId, scope, budget);
}

test("real renewed scope projects its exact already queried supersession without a second head read", async () => {
  await harness.database().$transaction(async (tx) => {
    const budget = new PublicationAuthorityReadBudget();
    const audit = proofQueryAudit(tx);
    try {
      const current = await snapshot(tx, budget);
      expect(current.scope.supersessions).toHaveLength(1);
      const queries = await audit.returned();
      const remaining = budget.take;
      const rows = current.supersessions.consume(tx, current.scope, budget);
      expect(rows.map(({ row }) => row.id)).toEqual([
        fixture.oldContinuation.id,
      ]);
      expect(rows[0]?.row.executionEvidence).toEqual(
        fixture.oldContinuation.executionEvidence,
      );
      expect(await audit.returned()).toBe(queries);
      expect(budget.take).toBe(remaining);
      expect(() =>
        current.supersessions.consume(tx, current.scope, budget),
      ).toThrow("consumed");
    } finally {
      audit.restore();
    }
  });
});

test.each(["budget", "scope", "target", "copied"] as const)(
  "locked projection rejects %s rather than falling back to another read",
  async (change) => {
    await harness.database().$transaction(async (tx) => {
      const budget = new PublicationAuthorityReadBudget();
      const current = await snapshot(tx, budget);
      const scope = structuredClone(current.scope);
      if (change === "scope") scope.request.runtimeVersion++;
      if (change === "target") {
        const target = scope.supersessions?.[0];
        if (target === undefined)
          throw new Error("Real supersession target missing");
        target.version++;
      }
      if (change === "copied") {
        const copied = Object.assign({}, current.supersessions);
        expect(() =>
          current.supersessions.consume.call(copied, tx, scope, budget),
        ).toThrow();
      } else {
        expect(() =>
          current.supersessions.consume(
            tx,
            scope,
            change === "budget" ? new PublicationAuthorityReadBudget() : budget,
          ),
        ).toThrow("projection changed");
      }
    });
  },
);

test("mutating an actual queried raw continuation after snapshot is detected before reuse", async () => {
  await harness.database().$transaction(async (tx) => {
    const query = vi.spyOn(
      tx.nativeArchiveCleanupContinuation,
      "findUniqueOrThrow",
    );
    try {
      const budget = new PublicationAuthorityReadBudget();
      const current = await snapshot(tx, budget);
      let mutated = false;
      for (const result of query.mock.results) {
        if (result.type !== "return") continue;
        const row = await result.value;
        if (row.id === fixture.oldContinuation.id) {
          row.version++;
          mutated = true;
        }
      }
      expect(mutated).toBe(true);
      expect(() =>
        current.supersessions.consume(tx, current.scope, budget),
      ).toThrow("projection changed");
    } finally {
      query.mockRestore();
    }
  });
});

test("projection cannot leave its original locked transaction", async () => {
  const budget = new PublicationAuthorityReadBudget();
  const current = await harness
    .database()
    .$transaction((tx) => snapshot(tx, budget));
  await harness.database().$transaction((tx) => {
    expect(() =>
      current.supersessions.consume(tx, current.scope, budget),
    ).toThrow("another transaction/budget");
    return Promise.resolve();
  });
});

test("real Files apply rejects an intervening own-row change at the exact supersession CAS", async () => {
  await prepared.observe(activity);
  const db = harness.database();
  const before = await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: fixture.oldContinuation.id },
  });
  let changed = false;
  const original = archiveSupersession.commitArchiveSupersessions;
  const commit = vi
    .spyOn(archiveSupersession, "commitArchiveSupersessions")
    .mockImplementation(async (tx, input, budget, options) => {
      await tx.nativeArchiveCleanupContinuation.update({
        where: { id: fixture.oldContinuation.id },
        data: { version: { increment: 1 } },
      });
      changed = true;
      return original(tx, input, budget, options);
    });
  try {
    await expect(
      prepared.files.applyNativeArchiveFiles(activity),
    ).rejects.toThrow("changed before its exact write");
    expect(changed).toBe(true);
  } finally {
    commit.mockRestore();
  }
  expect(
    await db.nativeArchiveCleanupContinuation.findUniqueOrThrow({
      where: { id: before.id },
    }),
  ).toEqual(before);
  expect(
    await db.nativeRecoveryReceipt.findUnique({
      where: { planId: activity.planId },
    }),
  ).toBeNull();
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: activity.planId },
  });
  expect(plan.state).toBe("applying");
});
