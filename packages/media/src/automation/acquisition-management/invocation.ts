import type { MediaAutomationContext } from "#automation/context.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";

/** Capture once before the first await. Never mutate a cached worker context or replace a caller's allowance. */
export async function acquisitionInvocation(
  initial: MediaAutomationContext,
  target: { mediaId: string } | { attemptId: string },
) {
  if (initial.libraryManagement !== undefined) {
    initial.libraryManagement.freshness.assertActive();
    return initial;
  }
  const execution = initial.plexBindingExecution();
  execution.assertActive();
  const attempt =
    "attemptId" in target
      ? await initial.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: target.attemptId },
          select: { mediaIds: true },
        })
      : null;
  const mediaIds = "mediaId" in target ? [target.mediaId] : attempt?.mediaIds;
  if (mediaIds === undefined)
    throw new Error("Acquisition invocation lost its target");
  const episode = await initial.db.mediaItem.findFirst({
    where: { id: { in: mediaIds }, kind: "episode" },
    select: { id: true },
  });
  const context = { ...initial, plexBindingExecution: () => execution };
  if (episode === null) return context;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [
      execution,
      {
        assertActive: () => {
          execution.signal.throwIfAborted();
        },
      },
    ],
  });
  const access = await initial.plexAccess("show");
  freshness.assertActive();
  return {
    ...context,
    libraryManagement: {
      freshness,
      access,
      budget:
        initial.movieManagement?.budget ?? new PublicationAuthorityReadBudget(),
    },
  };
}
