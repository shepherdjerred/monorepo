import type { Prisma } from "#generated/prisma/client.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  NativeCompensationExecutionSchema,
  type NativeCompensationExecution,
} from "#shared/native-recovery/compensation.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertCompensationPhaseTransaction,
  type CompensationExecutionPhase,
} from "#infrastructure/native-compensation/guards.ts";
import {
  compensationMeasurementEntry,
  type CompensationExecutionDiscovery,
} from "./discovery.ts";
import { persistCompensationPhaseExecution } from "#infrastructure/native-compensation/completion.ts";

/** Measurement never authorizes: compare it only with a NEW complete locked phase. */
export function assertCompensationDiscovery(
  tx: Prisma.TransactionClient,
  phase: CompensationExecutionPhase,
  discovery: CompensationExecutionDiscovery,
  input: {
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
): void {
  assertCompensationPhaseTransaction(tx, phase);
  const { execution, budget } = input;
  plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(execution.expiresAtMs, discovery.expiresAtMs),
    guards: [execution],
  }).assertActive();
  if (
    phase.budget !== budget ||
    identityHash(discovery.observed) !== identityHash(execution.observed) ||
    discovery.expiresAtMs >
      Math.min(execution.expiresAtMs, execution.observed.wall + 60_000) ||
    identityHash(phase.activity) !== identityHash(discovery.activity) ||
    phase.operation.userId !== discovery.actorId ||
    identityHash(phase.operation.payload) !== discovery.commandHash ||
    phase.plex === null ||
    identityHash(phase.plex.ref) !== identityHash(discovery.ref) ||
    phase.plex.expiresAtMs > discovery.expiresAtMs ||
    identityHash(
      phase.chain.map(({ row }) => compensationMeasurementEntry(row)),
    ) !== identityHash(discovery.chain)
  )
    throw new Error(
      "Compensation measurement changed before its full authority phase",
    );
}

/** Own CAS plus its existing actual readback; never advances from a guessed version. */
export async function persistCompensationDiscoveryExecution(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    executionEvidence: NativeCompensationExecution;
  },
  phase: CompensationExecutionPhase,
  options: {
    discovery: CompensationExecutionDiscovery;
    execution: PlexBindingExecution;
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<CompensationExecutionDiscovery> {
  const { discovery, freshness, budget } = options;
  assertCompensationDiscovery(tx, phase, discovery, options);
  const before = discovery.chain[0];
  if (before === undefined)
    throw new Error("Compensation measurement omitted current entry");
  const originalHash = identityHash(discovery);
  const execution = NativeCompensationExecutionSchema.parse(
    input.executionEvidence,
  );
  await persistCompensationPhaseExecution(
    tx,
    {
      activity: input.activity,
      execution,
    },
    phase,
    { freshness, budget },
  );
  // The existing writer has verified the full scalar row against its exact CAS
  // and charged that readback before updating this phase's current record.
  const after = compensationMeasurementEntry(
    assertCompensationPhaseTransaction(tx, phase).row,
  );
  if (
    identityHash(discovery) !== originalHash ||
    identityHash(before.descriptor) !== identityHash(after.descriptor) ||
    after.locator.executionHash !== identityHash(execution) ||
    identityHash(after.locator) !==
      identityHash(
        before.execution === null
          ? {
              ...before.locator,
              executionHash: identityHash(execution),
              version: before.locator.version + 1,
              state: "compensating",
            }
          : before.locator,
      )
  )
    throw new Error(
      "Compensation measurement advance lacks its exact own-write readback",
    );
  const advanced = {
    ...discovery,
    chain: [after, ...discovery.chain.slice(1)],
  };
  assertCompensationDiscovery(tx, phase, advanced, options);
  freshness.assertActive();
  return advanced;
}
