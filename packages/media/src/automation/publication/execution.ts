import type { Prisma } from "#generated/prisma/client.ts";
import type {
  NativeCompensationExecutionContext,
  NativeCompensationVerifiedPublication,
} from "#shared/native-recovery/compensation-runtime.ts";
import { compensationAwait } from "#migration/native-compensation/execution.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { CompensationPublicationPhase } from "#infrastructure/native-compensation/publication/phase.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

export type CompensationPublicationPort = {
  continuationId: string;
  execution: NativeCompensationExecutionContext;
  beforeNetwork: () => Promise<void>;
  loadPhase: (
    tx: Prisma.TransactionClient,
    budget: PublicationAuthorityReadBudget,
  ) => Promise<CompensationPublicationPhase>;
  commitVerified: (
    tx: Prisma.TransactionClient,
    input: {
      items: NativeCompensationVerifiedPublication["items"];
      phase: CompensationPublicationPhase;
      freshness: PlexBindingFreshness;
      budget: PublicationAuthorityReadBudget;
    },
  ) => Promise<void>;
};

/** Ordinary publication retains its existing execution contract. */
export function publicationAwait<T>(
  execution: NativeCompensationExecutionContext | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return execution === undefined ? work() : compensationAwait(execution, work);
}
