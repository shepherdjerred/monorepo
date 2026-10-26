import type { Prisma } from "#generated/prisma/client.ts";
import type { z } from "zod";
import { NativeArchiveExecutionSchema } from "#shared/native-recovery/archive.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import {
  assertArchivePhaseTransaction,
  type ArchiveExecutionPhase,
} from "#infrastructure/native-archive/continuation.ts";
import { persistArchivePhaseExecution } from "#infrastructure/native-archive/execution-phase.ts";
import {
  archiveMeasurementEntry,
  type ArchiveExecutionDiscovery,
} from "./discovery.ts";

/** Measurement data cannot substitute for a new, complete locked authority phase. */
export function assertArchiveDiscovery(
  tx: Prisma.TransactionClient,
  phase: ArchiveExecutionPhase,
  discovery: ArchiveExecutionDiscovery,
  input: {
    execution: PlexBindingExecution;
    budget: PublicationAuthorityReadBudget;
  },
): void {
  const authority = assertArchivePhaseTransaction(tx, phase);
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
    identityHash(authority.networkScope) !==
      identityHash(discovery.effectiveScope) ||
    identityHash(archiveMeasurementEntry(authority.row)) !==
      identityHash(discovery.entry)
  )
    throw new Error(
      "Archive measurement changed before its full authority phase",
    );
}

/** The unchanged writer performs the actual CAS and charged full scalar readback. */
export async function persistArchiveDiscoveryExecution(
  tx: Prisma.TransactionClient,
  raw: z.infer<typeof NativeArchiveExecutionSchema>,
  phase: ArchiveExecutionPhase,
  options: {
    discovery: ArchiveExecutionDiscovery;
    execution: PlexBindingExecution;
    freshness: PlexBindingFreshness;
    budget: PublicationAuthorityReadBudget;
  },
): Promise<ArchiveExecutionDiscovery> {
  const { discovery, freshness, budget } = options;
  assertArchiveDiscovery(tx, phase, discovery, options);
  const before = discovery.entry;
  const originalHash = identityHash(discovery);
  const execution = NativeArchiveExecutionSchema.parse(raw);
  await persistArchivePhaseExecution(tx, execution, phase, {
    freshness,
    budget,
  });
  const after = archiveMeasurementEntry(
    assertArchivePhaseTransaction(tx, phase).row,
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
            }
          : before.locator,
      )
  )
    throw new Error(
      "Archive measurement advance lacks its exact own-write readback",
    );
  const advanced = { ...discovery, entry: after };
  assertArchiveDiscovery(tx, phase, advanced, options);
  freshness.assertActive();
  return advanced;
}
