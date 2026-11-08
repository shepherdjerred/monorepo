import type { Database } from "#infrastructure/database.ts";

/** Current authority only: no historical event payload, paths or credentials. */
export function recoveryAuthority(db: Database) {
  return db.$transaction(
    async (tx) => {
      const runtime = await tx.mediaRuntimeState.findUnique({
        where: { id: "singleton" },
      });
      const writer = await tx.legacyWriterLease.findUnique({
        where: { id: "singleton" },
      });
      const storage = await tx.mediaStorageAuthority.findMany();
      const epoch = runtime?.recoveryEpoch ?? -1;
      return {
        mode: runtime?.mode ?? "uninitialized",
        ownershipConfirmed: runtime?.ownershipConfirmed ?? false,
        writerState: authorityState(writer === null ? [] : [writer], epoch),
        storageState: authorityState(storage, epoch),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

function authorityState(
  rows: {
    recoveryEpoch: number;
    revokedAt: Date | null;
    expiresAt: Date;
    observedAt: Date;
  }[],
  epoch: number,
) {
  if (rows.length === 0) return "missing";
  if (rows.some((row) => row.revokedAt !== null)) return "revoked";
  const now = Date.now();
  return rows.some(
    (row) =>
      row.recoveryEpoch !== epoch ||
      row.expiresAt.getTime() <= now ||
      row.observedAt.getTime() > now,
  )
    ? "stale"
    : "current";
}
