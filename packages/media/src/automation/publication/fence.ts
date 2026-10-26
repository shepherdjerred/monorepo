import type { MediaAutomationContext } from "#automation/context.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  lockRuntimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import type { CompensationPublicationPort } from "./execution.ts";
import { serializable } from "#automation/store.ts";
import { lockPlexBindingScope } from "#infrastructure/plex-binding/authority.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { assertMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import type { preparePublicationBindingExpected } from "./binding.ts";

export async function assertPublicationCommitAuthority(
  tx: Prisma.TransactionClient,
  input: { epoch: number; mediaIds: string[]; assetIds: string[] },
) {
  if (
    !(await lockRuntimeAuthority(tx, input.epoch)) ||
    !(await recordsAuthorized(tx, input))
  )
    throw new Error("Publication ownership authority changed");
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  const currentRuntime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    currentRuntime.mode !== "active" ||
    !currentRuntime.ownershipConfirmed ||
    currentRuntime.recoveryEpoch !== input.epoch
  )
    throw new Error("Publication recovery epoch changed");
}

export async function beforePublicationRefresh(
  context: MediaAutomationContext,
  prepared: Awaited<ReturnType<typeof preparePublicationBindingExpected>>,
  compensation: CompensationPublicationPort | undefined,
) {
  await compensation?.beforeNetwork();
  return serializable(context.db, async (tx) => {
    const budget = prepared.source.budget;
    const compensationPhase = await compensation?.loadPhase(tx, budget);
    await lockPlexBindingScope(tx, prepared.lockScope, prepared.freshness, {
      budget,
      compensationPhase,
    });
    // The common lock checks runtime, lease, records and the exact original parent.
    // Preserve its observed lease/choice deadlines through the immediate HTTP dispatch.
    const lease = await tx.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const guards: MovieChoiceFreshness[] = [];
    const movie = prepared.access.find(
      (access) => access.sectionType === "movie",
    );
    for (const parent of prepared.expected.parents) {
      if (movie === undefined || parent.kind !== "acquisition") continue;
      const guard = await assertMovieAttemptChoice(tx, {
        attemptId: parent.attemptId,
        purpose: "new_acquisition_effect",
        access: {
          serverMachineId: movie.serverMachineId,
          movieSectionId: movie.sectionId,
        },
      });
      if (guard !== null) guards.push(guard);
    }
    const freshness = plexBindingFreshness({
      observed: prepared.source.execution.observed,
      expiresAtMs: Math.min(
        prepared.freshness.expiresAtMs,
        compensationPhase?.freshness.expiresAtMs ??
          prepared.freshness.expiresAtMs,
        lease.expiresAt.getTime(),
        ...guards.map((guard) => guard.expiresAtMs),
      ),
      guards: [
        prepared.freshness,
        ...guards,
        ...(compensationPhase === undefined
          ? []
          : [compensationPhase.freshness]),
      ],
    });
    await bindPlexTransactionDeadline(tx, freshness);
    freshness.assertActive();
    return freshness;
  });
}
