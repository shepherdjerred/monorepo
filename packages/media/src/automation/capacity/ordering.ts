import type { Database } from "#infrastructure/database.ts";
import type {
  Prisma,
  MediaCapacityObservation,
} from "#generated/prisma/client.ts";
import {
  CAPACITY_ROLES,
  CapacityCycleSchema,
  type CapacityCycle,
} from "#shared/capacity/contract.ts";
import { serializable } from "#automation/store.ts";
import { assertActive, type CapacityExecution } from "./execution.ts";

export async function lockCapacity(
  tx: Prisma.TransactionClient,
  execution: CapacityExecution,
  initialize = false,
) {
  assertActive(execution);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  assertActive(execution);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  for (const role of CAPACITY_ROLES) {
    assertActive(execution);
    if (initialize)
      await tx.mediaCapacityObservation.upsert({
        where: { role },
        create: {
          role,
          cycleEpoch: runtime.recoveryEpoch,
          cycleStartedAt: new Date(),
        },
        update: {},
      });
    assertActive(execution);
    await tx.$queryRaw`SELECT role FROM "MediaCapacityObservation" WHERE role = ${role} FOR UPDATE`;
    assertActive(execution);
  }
  return runtime;
}

export function matchesCycle(
  rows: readonly MediaCapacityObservation[],
  cycle: CapacityCycle,
  epoch: number,
): boolean {
  return (
    epoch === cycle.recoveryEpoch &&
    rows.length === 2 &&
    cycle.cycles.every((entry) =>
      rows.some(
        (row) =>
          row.role === entry.role &&
          row.cycleEpoch === epoch &&
          row.cycleRevision === BigInt(entry.revision),
      ),
    )
  );
}

export async function beginCapacityCycle(
  db: Database,
  execution: CapacityExecution,
): Promise<CapacityCycle> {
  return await serializable(db, async (tx) => {
    assertActive(execution);
    const runtime = await lockCapacity(tx, execution, true);
    const now = new Date();
    const cycles = [];
    for (const role of CAPACITY_ROLES) {
      const row = await tx.mediaCapacityObservation.update({
        where: { role },
        data: {
          cycleRevision: { increment: 1 },
          cycleEpoch: runtime.recoveryEpoch,
          cycleStartedAt: now,
        },
      });
      cycles.push({ role, revision: String(row.cycleRevision) });
      assertActive(execution);
    }
    return CapacityCycleSchema.parse({
      recoveryEpoch: runtime.recoveryEpoch,
      cycles,
    });
  });
}
