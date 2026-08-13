import type { Prisma } from "#generated/prisma/client/index.js";

export async function replaceOccurrenceLabels(
  transaction: Prisma.TransactionClient,
  occurrenceId: string,
  labels: Readonly<Record<string, string>>,
): Promise<void> {
  const entries = Object.entries(labels);

  await transaction.alertOccurrenceLabel.deleteMany({
    where: { occurrenceId },
  });

  if (entries.length === 0) {
    return;
  }

  await transaction.alertOccurrenceLabel.createMany({
    data: entries.map(([key, value]) => ({
      occurrenceId,
      key,
      value,
    })),
  });
}
