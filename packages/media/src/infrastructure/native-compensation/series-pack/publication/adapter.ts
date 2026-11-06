import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingLockScope } from "#shared/plex-binding/expected.ts";
import {
  assertCompensationPublicationPhase as assertHistoricalPhase,
  assertCompensationPublicationPhaseCurrent as assertHistoricalCurrent,
  assertCompensationPublicationLockScope as assertHistoricalLockScope,
  type CompensationPublicationPhase as HistoricalPhase,
} from "#infrastructure/native-compensation/publication/phase.ts";
import {
  assertSeriesPackNativePublicationPhaseV1,
  assertSeriesPackNativePublicationPhaseCurrentV1,
  assertSeriesPackNativePublicationLockScopeV1,
  type SeriesPackNativePublicationPhaseV1,
} from "./phase.ts";

export type CompensationPublicationPhase =
  HistoricalPhase | SeriesPackNativePublicationPhaseV1;

/** The explicit new phase is backed by an actual strict descriptor2 parent.
 * Absence follows the existing descriptor1 assertion body without projection. */
export function assertCompensationPublicationPhase(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  budget: PublicationAuthorityReadBudget,
) {
  return "protocol" in phase
    ? assertSeriesPackNativePublicationPhaseV1(tx, phase, budget)
    : assertHistoricalPhase(tx, phase, budget);
}

export function assertCompensationPublicationLockScope(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  scope: PlexBindingLockScope,
  budget: PublicationAuthorityReadBudget,
) {
  if ("protocol" in phase) {
    assertSeriesPackNativePublicationLockScopeV1(tx, phase, scope, budget);
    return;
  }
  assertHistoricalLockScope(tx, phase, scope, budget);
}

export function assertCompensationPublicationPhaseCurrent(
  tx: Prisma.TransactionClient,
  phase: CompensationPublicationPhase,
  budget: PublicationAuthorityReadBudget,
) {
  return "protocol" in phase
    ? assertSeriesPackNativePublicationPhaseCurrentV1(tx, phase, budget)
    : assertHistoricalCurrent(tx, phase, budget);
}
