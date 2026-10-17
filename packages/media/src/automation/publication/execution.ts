import type { Prisma } from "#generated/prisma/client.ts";
import type {
  NativeCompensationExecutionContext,
  NativeCompensationVerifiedPublication,
} from "#shared/native-recovery/compensation-runtime.ts";
import { compensationAwait } from "#migration/native-compensation/execution.ts";

export type CompensationPublicationPort = {
  execution: NativeCompensationExecutionContext;
  beforeNetwork: () => Promise<void>;
  lockAndAssert: (tx: Prisma.TransactionClient) => Promise<void>;
  commitVerified: (
    tx: Prisma.TransactionClient,
    items: NativeCompensationVerifiedPublication["items"],
  ) => Promise<void>;
};

/** Ordinary publication retains its existing execution contract. */
export function publicationAwait<T>(
  execution: NativeCompensationExecutionContext | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return execution === undefined ? work() : compensationAwait(execution, work);
}
