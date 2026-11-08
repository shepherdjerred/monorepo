import { z } from "zod";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  FileGuardError,
  now,
  type RemovalEntry,
  type Transaction,
} from "#automation/files/types.ts";
import { requireFreshRetentionStart } from "#automation/files/retention-freshness.ts";

/** Anchored before IO; a later Network refresh requires a new physical invocation. */
export function retentionPlexFreshness(input: {
  context: PublicationContext;
  observed: { wall: number; monotonic: number };
  evidence: unknown;
}) {
  const evidence = z
    .object({
      authorizedAt: z.iso.datetime(),
      activePlayback: z.literal(false),
      plexExpiresAtMs: z.number().int().optional(),
    })
    .parse(input.evidence);
  const expiresAtMs = evidence.plexExpiresAtMs;
  if (expiresAtMs === undefined)
    throw new FileGuardError("reconciliation_required");
  return plexBindingFreshness({
    observed: input.observed,
    expiresAtMs,
    guards: [
      input.context.execution,
      {
        assertActive: () => {
          requireFreshRetentionStart(input.context, input.evidence);
          if (now(input.context).getTime() >= expiresAtMs)
            throw new FileGuardError("retention_evidence_expired");
        },
      },
    ],
  });
}

/** Storage waits cannot renew either the original Network budget or SDK execution. */
export async function removalEffectFreshness(
  tx: Transaction,
  input: {
    context: PublicationContext;
    plan: readonly RemovalEntry[];
    epoch: number;
    observed: { wall: number; monotonic: number };
    original: PlexBindingFreshness | null;
  },
) {
  const guards: PlexBindingFreshness[] =
    input.original === null ? [] : [input.original];
  for (const libraryKind of [
    ...new Set(input.plan.map((entry) => entry.libraryKind)),
  ].sort()) {
    guards.push(
      await publicationAuthorityDeadline(tx, input.context, {
        libraryKind,
        recoveryEpoch: input.epoch,
      }),
    );
    input.original?.assertActive();
  }
  const expiresAtMs = Math.min(...guards.map((guard) => guard.expiresAtMs));
  const monotonicDeadline =
    input.observed.monotonic + expiresAtMs - input.observed.wall;
  const freshness: PlexBindingFreshness = {
    expiresAtMs,
    assertActive: () => {
      input.context.execution.assertActive();
      for (const guard of guards) guard.assertActive();
      if (
        !Number.isFinite(expiresAtMs) ||
        !Number.isFinite(monotonicDeadline) ||
        Date.now() < input.observed.wall ||
        Date.now() >= expiresAtMs ||
        performance.now() >= monotonicDeadline
      )
        throw new FileGuardError("retention_evidence_expired");
    },
  };
  await bindPlexTransactionDeadline(tx, freshness);
  freshness.assertActive();
  return freshness;
}
