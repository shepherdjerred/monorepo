import type { Prisma } from "#generated/prisma/client/index.js";
import type {
  ReconcileSnapshotInput,
  ReconcileSnapshotResult,
} from "#application/ports";
import {
  eventId,
  observedLastSeenAtNs,
  occurrenceId,
  snapshotStartNs,
  suppressionFromSnapshot,
} from "#domain/alert";
import {
  createOccurrenceLabels,
  syncOccurrenceLabels,
} from "#infrastructure/prisma-labels";
import {
  findObservedOccurrence,
  observedChanges,
  observedFields,
} from "#infrastructure/prisma-occurrence";
import {
  SnapshotRunIdSchema,
  type AlertmanagerSnapshotAlert,
} from "#shared/schema";

type Observation = { id: string; opened: number };

async function openSnapshotOccurrence(
  transaction: Prisma.TransactionClient,
  alert: AlertmanagerSnapshotAlert,
  completedAtNs: bigint,
): Promise<Observation> {
  const startedAtNs = snapshotStartNs(alert);
  const id = occurrenceId(alert.fingerprint, startedAtNs);
  await transaction.alertOccurrence.create({
    data: {
      id,
      source: "alertmanager",
      fingerprint: alert.fingerprint,
      startedAtNs,
      openedAtNs: startedAtNs,
      lastSeenAtNs: completedAtNs,
      lifecycleState: "open",
      suppressionState: suppressionFromSnapshot(alert),
      ...observedFields(alert),
    },
  });
  await createOccurrenceLabels(transaction, id, alert.labels);
  await transaction.alertEvent.create({
    data: {
      id: eventId(id, "opened", startedAtNs),
      occurrenceId: id,
      type: "opened",
      occurredAtNs: startedAtNs,
      source: "snapshot",
    },
  });
  return { id, opened: 1 };
}

/**
 * Applies one snapshot observation to its stored occurrence, writing only what
 * changed. An open occurrence that was already present in the previous
 * snapshot and carries the same metadata is not written at all: its liveness
 * is derived from the latest successful snapshot run (see
 * `observedLastSeenAtNs`).
 */
async function observeSnapshotAlert(
  transaction: Prisma.TransactionClient,
  alert: AlertmanagerSnapshotAlert,
  completedAtNs: bigint,
): Promise<Observation> {
  const existing = await findObservedOccurrence(
    transaction,
    alert.fingerprint,
    snapshotStartNs(alert),
  );
  if (existing === null)
    return openSnapshotOccurrence(transaction, alert, completedAtNs);

  const suppressionState = suppressionFromSnapshot(alert);
  const suppressionChanged = existing.suppressionState !== suppressionState;
  const shouldReopen =
    existing.lifecycleState === "resolved" &&
    existing.resolutionSource === "reconciled";
  const present =
    existing.lifecycleState === "open" &&
    existing.missingSinceNs === null &&
    existing.absentSnapshots === 0;
  const changes = observedChanges(existing, alert);
  const data: Prisma.AlertOccurrenceUpdateInput = {
    ...changes.data,
    ...(suppressionChanged ? { suppressionState } : {}),
    ...(present
      ? {}
      : {
          lastSeenAtNs: completedAtNs,
          missingSinceNs: null,
          absentSnapshots: 0,
        }),
    ...(shouldReopen
      ? { lifecycleState: "open", resolvedAtNs: null, resolutionSource: null }
      : {}),
  };
  if (Object.keys(data).length > 0)
    await transaction.alertOccurrence.update({
      where: { id: existing.id },
      data,
    });
  if (changes.labelsChanged)
    await syncOccurrenceLabels(transaction, existing.id, alert.labels);
  if (shouldReopen)
    await transaction.alertEvent.create({
      data: {
        id: eventId(existing.id, "reopened_reconciled", completedAtNs),
        occurrenceId: existing.id,
        type: "opened",
        occurredAtNs: completedAtNs,
        source: "reconciliation",
        detail: { previousResolutionSource: "reconciled" },
      },
    });
  if (suppressionChanged)
    await transaction.alertEvent.create({
      data: {
        id: eventId(
          existing.id,
          `suppression_changed_${suppressionState}`,
          completedAtNs,
        ),
        occurrenceId: existing.id,
        type: "suppression_changed",
        occurredAtNs: completedAtNs,
        source: "snapshot",
        detail: { from: existing.suppressionState, to: suppressionState },
      },
    });
  return { id: existing.id, opened: shouldReopen ? 1 : 0 };
}

type AbsentOccurrence = {
  id: string;
  lastSeenAtNs: bigint;
  missingSinceNs: bigint | null;
  absentSnapshots: number;
};

/**
 * Records one more absence for an open occurrence and resolves it once it has
 * been missing past the grace period. The first absence materializes the
 * derived last-seen instant, because from then on the occurrence no longer
 * tracks the latest snapshot.
 */
async function recordAbsence(
  transaction: Prisma.TransactionClient,
  occurrence: AbsentOccurrence,
  input: ReconcileSnapshotInput,
  previousSnapshotNs: bigint | null,
): Promise<number> {
  const firstAbsence = occurrence.missingSinceNs === null;
  const missingSinceNs = occurrence.missingSinceNs ?? input.completedAtNs;
  const absentSnapshots = occurrence.absentSnapshots + 1;
  const lastSeen = firstAbsence
    ? {
        lastSeenAtNs: observedLastSeenAtNs(
          { ...occurrence, lifecycleState: "open" },
          previousSnapshotNs,
        ),
      }
    : {};
  const pastGrace =
    input.completedAtNs - missingSinceNs >= input.missingGraceNs;
  if (pastGrace && absentSnapshots >= 2) {
    await transaction.alertOccurrence.update({
      where: { id: occurrence.id },
      data: {
        lifecycleState: "resolved",
        resolvedAtNs: input.completedAtNs,
        resolutionSource: "reconciled",
        missingSinceNs,
        absentSnapshots,
        ...lastSeen,
      },
    });
    await transaction.alertEvent.create({
      data: {
        id: eventId(occurrence.id, "resolved_reconciled", input.completedAtNs),
        occurrenceId: occurrence.id,
        type: "resolved",
        occurredAtNs: input.completedAtNs,
        source: "reconciliation",
        detail: { absentSnapshots },
      },
    });
    return 1;
  }
  await transaction.alertOccurrence.update({
    where: { id: occurrence.id },
    data: { missingSinceNs, absentSnapshots, ...lastSeen },
  });
  if (firstAbsence)
    await transaction.alertEvent.create({
      data: {
        id: eventId(
          occurrence.id,
          "reconciliation_discrepancy",
          input.completedAtNs,
        ),
        occurrenceId: occurrence.id,
        type: "reconciliation_discrepancy",
        occurredAtNs: input.completedAtNs,
        source: "reconciliation",
        detail: { absentSnapshots },
      },
    });
  return 0;
}

/**
 * Reconciles one Alertmanager snapshot inside the caller's transaction. An
 * unchanged snapshot writes only its `SnapshotRun` row.
 */
export async function reconcileSnapshotRows(
  transaction: Prisma.TransactionClient,
  input: ReconcileSnapshotInput,
): Promise<ReconcileSnapshotResult> {
  const previousRun = await transaction.snapshotRun.findFirst({
    where: { status: "success" },
    orderBy: { completedAtNs: "desc" },
    select: { completedAtNs: true },
  });
  const activeIds = new Set<string>();
  let opened = 0;
  let resolved = 0;
  for (const alert of input.alerts) {
    const observation = await observeSnapshotAlert(
      transaction,
      alert,
      input.completedAtNs,
    );
    activeIds.add(observation.id);
    opened += observation.opened;
  }

  // A webhook observation newer than this snapshot's fetch is fresher evidence
  // than the snapshot's absence, so those occurrences are left alone.
  const openOccurrences = await transaction.alertOccurrence.findMany({
    where: { lifecycleState: "open", lastSeenAtNs: { lte: input.startedAtNs } },
    select: {
      id: true,
      lastSeenAtNs: true,
      missingSinceNs: true,
      absentSnapshots: true,
    },
  });
  for (const occurrence of openOccurrences) {
    if (activeIds.has(occurrence.id)) continue;
    resolved += await recordAbsence(
      transaction,
      occurrence,
      input,
      previousRun?.completedAtNs ?? null,
    );
  }

  await transaction.snapshotRun.create({
    data: {
      id: SnapshotRunIdSchema.parse(crypto.randomUUID()),
      startedAtNs: input.startedAtNs,
      completedAtNs: input.completedAtNs,
      status: "success",
      activeCount: input.alerts.length,
      openedCount: opened,
      resolvedCount: resolved,
    },
  });
  return { active: input.alerts.length, opened, resolved };
}
