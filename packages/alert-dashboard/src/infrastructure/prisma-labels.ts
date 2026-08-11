import type { Prisma } from "#generated/prisma/client/index.js";

export async function replaceOccurrenceLabels(
  transaction: Prisma.TransactionClient,
  occurrenceId: string,
  labels: Readonly<Record<string, string>>,
): Promise<void> {
  await transaction.alertOccurrenceLabel.deleteMany({
    where: { occurrenceId },
  });
  await transaction.alertOccurrenceLabel.createMany({
    data: Object.entries(labels).map(([key, value]) => ({
      occurrenceId,
      key,
      value,
    })),
  });
}
