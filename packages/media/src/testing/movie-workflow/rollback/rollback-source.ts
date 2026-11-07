import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { createMovieRollbackFixture } from "./rollback-fixture.ts";
import { createSeedingActivities } from "#automation/seeding.ts";

/** Resolve the actual already-created seed operation. There are no synthetic
 * seed ids, adoption/tag changes or extra budgets in this SDK test facade. */
export async function movieRollbackSourceHarness(input: {
  context: MediaAutomationContext;
  source: MovieAttemptOperationV4;
  wire: Awaited<ReturnType<typeof createMovieRollbackFixture>>["wire"];
}) {
  const attempt = await input.context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.source.attemptId },
  });
  const torrentId = z.uuid().parse(attempt.torrentId);
  const seed = await input.context.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `seed:${torrentId}` },
  });
  if (seed.kind !== "maintain_torrent" || seed.targetId !== torrentId)
    throw new Error("Rollback source fixture lost its actual seed operation");
  const context = (
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => ({
    ...input.context,
    plexBindingExecution: () => execution,
    movieManagement: { execution, budget },
  });
  const seeding = {
    evaluateMediaSeeding: (
      operation: { operationId: string; torrentId: string },
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      createSeedingActivities(context(execution, budget)).evaluateMediaSeeding(
        operation,
      ),
    removeMediaTorrent: (
      operation: { operationId: string; torrentId: string },
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) =>
      createSeedingActivities(context(execution, budget)).removeMediaTorrent(
        operation,
      ),
  };
  return {
    input: { operationId: seed.id, torrentId },
    seeding,
    setEligible: () => {
      input.wire.control.ratio = 1;
    },
  };
}
