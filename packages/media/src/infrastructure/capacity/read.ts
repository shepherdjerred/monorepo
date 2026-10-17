import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { decodeCapacityRow } from "./records.ts";
import { projectCapacity, type CapacitySnapshot } from "./project.ts";

export async function loadCapacitySnapshot(
  tx: Prisma.TransactionClient,
): Promise<CapacitySnapshot> {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const rows = await tx.mediaCapacityObservation.findMany({
    orderBy: { role: "asc" },
  });
  return {
    recoveryEpoch: runtime.recoveryEpoch,
    rows: rows.map((row) => decodeCapacityRow(row)),
  };
}
export function readCapacityView(
  db: Database,
  options: { samplingEnabled: boolean; now?: Date },
) {
  return db.$transaction(
    async (tx) =>
      projectCapacity(await loadCapacitySnapshot(tx), {
        samplingEnabled: options.samplingEnabled,
        now: options.now ?? new Date(),
      }),
    { isolationLevel: "RepeatableRead" },
  );
}
