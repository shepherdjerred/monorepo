import type { MediaAutomationContext } from "#automation/context.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { observeAssociatedWatch } from "./metadata.ts";
import { prepareWatchBatch, type PreparedWatchBatch } from "./prepare.ts";
import { finalizeWatchBatch, type WatchOutcome } from "./finalize.ts";
import { assertWatchActive, watchCheckpoint } from "./execution.ts";

async function readRequester(
  context: MediaAutomationContext,
  batch: PreparedWatchBatch,
  reader: PreparedWatchBatch["readers"][number],
  execution: PlexBindingExecution,
): Promise<WatchOutcome> {
  const unknown = {
    userId: reader.userId,
    outcome: { kind: "unknown" },
  } as const;
  const ratingKey = batch.authority.identity.plexRatingKey;
  if (
    ratingKey === undefined ||
    reader.serverToken === null ||
    batch.authority.binding === null
  )
    return unknown;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(
      batch.freshness.expiresAtMs,
      reader.verifyAccess
        ? batch.freshness.expiresAtMs
        : (reader.mappingExpiresAtMs ?? batch.freshness.expiresAtMs),
    ),
    guards: [batch.freshness],
  });
  const active = {
    ...execution,
    assertActive: () => {
      freshness.assertActive();
    },
  };
  const client = context.userPlex(reader.serverToken);
  try {
    if (reader.verifyAccess) {
      const machine = await client.machineIdentifier(execution.signal);
      await watchCheckpoint(active);
      if (machine !== context.serverMachineId) return unknown;
      const sections = await client.sections(execution.signal);
      await watchCheckpoint(active);
      const sectionType =
        batch.authority.media.kind === "movie" ? "movie" : "show";
      if (
        !sections.some(
          (section) =>
            section.key === batch.authority.identity.plexSectionId &&
            section.type === sectionType,
        )
      )
        return unknown;
    }
    const watched = await observeAssociatedWatch(
      { plex: client, execution: active, freshness },
      batch.authority.binding.association,
    );
    await watchCheckpoint(active);
    if (watched === null) return unknown;
    return {
      userId: reader.userId,
      outcome: {
        kind: "observed",
        watched,
        scopedAccess: reader.verifyAccess,
        freshness,
      },
    };
  } catch (error) {
    assertWatchActive(execution);
    if (!(error instanceof IntegrationError)) throw error;
    return unknown;
  }
}

export async function observeWatchBatch(
  context: MediaAutomationContext,
  mediaId: string,
  options: { expectedHint?: ObservePlexHintInput },
  execution: PlexBindingExecution,
) {
  await watchCheckpoint(execution);
  const batch = await prepareWatchBatch(context, mediaId, options, execution);
  if (batch === null)
    return {
      status: "superseded",
      complete: false,
      reason: "requester_watch_unknown",
      freshness: null,
    } as const;
  const outcomes: WatchOutcome[] = [];
  for (const reader of batch.readers) {
    await watchCheckpoint(execution);
    outcomes.push(await readRequester(context, batch, reader, execution));
  }
  const status = await finalizeWatchBatch(context, batch, outcomes, execution);
  const complete =
    status === "committed" &&
    batch.authority.identity.plexRatingKey !== undefined &&
    outcomes.every((item) => item.outcome.kind === "observed");
  const reason = complete
    ? null
    : batch.authority.identity.plexRatingKey === undefined
      ? "plex_identity_missing"
      : "requester_watch_unknown";
  const freshness = complete
    ? plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          batch.freshness.expiresAtMs,
          ...outcomes.flatMap((item) =>
            item.outcome.kind === "observed"
              ? [item.outcome.freshness.expiresAtMs]
              : [],
          ),
        ),
        guards: [
          batch.freshness,
          ...outcomes.flatMap((item) =>
            item.outcome.kind === "observed" ? [item.outcome.freshness] : [],
          ),
        ],
      })
    : null;
  return {
    status: status === "superseded" ? "superseded" : "observed",
    complete,
    reason,
    freshness,
  } as const;
}
