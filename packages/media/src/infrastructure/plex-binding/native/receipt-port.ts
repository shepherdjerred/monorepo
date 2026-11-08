import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type NativeReceiptRow = Prisma.NativeRecoveryReceiptGetPayload<{
  include: { plan: true };
}>;

/** Complete immutable receipt validation within one exact transaction and counter. */
export type NativeReceiptReadPort = {
  assertTransaction: (
    tx: Prisma.TransactionClient,
    budget: PublicationAuthorityReadBudget,
  ) => void;
  validateQueried: (
    tx: Prisma.TransactionClient,
    row: NativeReceiptRow,
    budget: PublicationAuthorityReadBudget,
  ) => Promise<NativeReceiptRow>;
  read: (
    tx: Prisma.TransactionClient,
    id: string,
    budget: PublicationAuthorityReadBudget,
  ) => Promise<NativeReceiptRow>;
  find: (
    tx: Prisma.TransactionClient,
    assetId: string,
    epoch: number,
    budget: PublicationAuthorityReadBudget,
  ) => Promise<NativeReceiptRow[]>;
};
