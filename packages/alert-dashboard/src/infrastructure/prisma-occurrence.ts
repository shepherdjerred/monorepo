import type {
  AlertOccurrence,
  Prisma,
} from "#generated/prisma/client/index.js";

async function lockAlertFingerprint(
  transaction: Prisma.TransactionClient,
  fingerprint: string,
): Promise<void> {
  const lockKey = `alertmanager:${fingerprint}`;
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
}

export async function lockAlertFingerprints(
  transaction: Prisma.TransactionClient,
  fingerprints: readonly string[],
): Promise<void> {
  const ordered = [...new Set(fingerprints)].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const fingerprint of ordered)
    await lockAlertFingerprint(transaction, fingerprint);
}

export async function findObservedOccurrence(
  transaction: Prisma.TransactionClient,
  fingerprint: string,
  startedAtNs: bigint,
): Promise<AlertOccurrence | null> {
  const exact = await transaction.alertOccurrence.findUnique({
    where: {
      source_fingerprint_startedAtNs: {
        source: "alertmanager",
        fingerprint,
        startedAtNs,
      },
    },
  });
  if (exact !== null) return exact;
  return transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "open",
    },
    orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
  });
}

export async function findWebhookOccurrence(
  transaction: Prisma.TransactionClient,
  fingerprint: string,
  startedAtNs: bigint,
  alertResolvedAtNs: bigint | null,
): Promise<AlertOccurrence | null> {
  const exact = await transaction.alertOccurrence.findUnique({
    where: {
      source_fingerprint_startedAtNs: {
        source: "alertmanager",
        fingerprint,
        startedAtNs,
      },
    },
  });
  if (exact !== null) return exact;

  const open = await transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "open",
      ...(alertResolvedAtNs === null
        ? {}
        : { openedAtNs: { lte: alertResolvedAtNs } }),
    },
    orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
  });
  if (open !== null) return open;

  // Push-based producers can refresh startsAt on every send. Once an occurrence
  // is closed, exact/open matching cannot attach delayed retries. A resolved
  // retry first matches the prior row's resolution instant, then may promote a
  // temporally eligible reconciled row. A firing retry may attach only when its
  // start predates the stored resolution.
  if (alertResolvedAtNs !== null) {
    const resolved = await transaction.alertOccurrence.findFirst({
      where: {
        source: "alertmanager",
        fingerprint,
        lifecycleState: "resolved",
        openedAtNs: { lte: alertResolvedAtNs },
        resolvedAtNs: alertResolvedAtNs,
      },
      orderBy: [{ openedAtNs: "desc" }, { id: "desc" }],
    });
    if (resolved !== null) return resolved;
    return transaction.alertOccurrence.findFirst({
      where: {
        source: "alertmanager",
        fingerprint,
        lifecycleState: "resolved",
        resolutionSource: "reconciled",
        openedAtNs: { lte: alertResolvedAtNs },
      },
      orderBy: [
        { resolvedAtNs: "desc" },
        { openedAtNs: "desc" },
        { id: "desc" },
      ],
    });
  }
  return transaction.alertOccurrence.findFirst({
    where: {
      source: "alertmanager",
      fingerprint,
      lifecycleState: "resolved",
      resolvedAtNs: { gte: startedAtNs },
    },
    orderBy: [{ resolvedAtNs: "desc" }, { openedAtNs: "desc" }, { id: "desc" }],
  });
}
