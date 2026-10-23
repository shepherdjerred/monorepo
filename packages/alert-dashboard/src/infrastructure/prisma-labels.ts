import type { Prisma } from "#generated/prisma/client/index.js";
import { labelChanges } from "#domain/alert";

/** Writes the indexed label rows of a newly created occurrence. */
export async function createOccurrenceLabels(
  transaction: Prisma.TransactionClient,
  occurrenceId: string,
  labels: Readonly<Record<string, string>>,
): Promise<void> {
  const entries = Object.entries(labels);
  if (entries.length === 0) return;
  await transaction.alertOccurrenceLabel.createMany({
    data: entries.map(([key, value]) => ({ occurrenceId, key, value })),
  });
}

/**
 * Brings an existing occurrence's indexed label rows to `labels`, touching only
 * the keys that were removed, added, or changed. Unchanged rows are not
 * rewritten, so a label set that did not change costs no writes.
 */
export async function syncOccurrenceLabels(
  transaction: Prisma.TransactionClient,
  occurrenceId: string,
  labels: Readonly<Record<string, string>>,
): Promise<void> {
  const rows = await transaction.alertOccurrenceLabel.findMany({
    where: { occurrenceId },
    select: { key: true, value: true },
  });
  const changes = labelChanges(
    Object.fromEntries(rows.map((row) => [row.key, row.value])),
    labels,
  );
  if (changes.removed.length > 0)
    await transaction.alertOccurrenceLabel.deleteMany({
      where: { occurrenceId, key: { in: changes.removed } },
    });
  for (const [key, value] of changes.upserted)
    await transaction.alertOccurrenceLabel.upsert({
      where: { occurrenceId_key: { occurrenceId, key } },
      create: { occurrenceId, key, value },
      update: { value },
    });
}
