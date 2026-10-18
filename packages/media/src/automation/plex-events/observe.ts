import type { MediaAutomationContext } from "#automation/context.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import { prepareWatchBatch, type PreparedWatchBatch } from "./prepare.ts";
import { finalizeWatchBatch, type WatchOutcome } from "./finalize.ts";
import {
  assertWatchActive,
  watchCheckpoint,
  type WatchExecution,
} from "./execution.ts";

async function readRequester(
  context: MediaAutomationContext,
  batch: PreparedWatchBatch,
  reader: PreparedWatchBatch["readers"][number],
  execution: WatchExecution,
): Promise<WatchOutcome> {
  const unknown = {
    userId: reader.userId,
    outcome: { kind: "unknown" },
  } as const;
  const ratingKey = batch.authority.identity.plexRatingKey;
  if (ratingKey === undefined || reader.serverToken === null) return unknown;
  const client = context.userPlex(reader.serverToken);
  try {
    if (reader.verifyAccess) {
      const machine = await client.machineIdentifier(execution.signal);
      await watchCheckpoint(execution);
      if (machine !== context.serverMachineId) return unknown;
      const sections = await client.sections(execution.signal);
      await watchCheckpoint(execution);
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
    const watched = await client.watched(ratingKey, execution.signal);
    await watchCheckpoint(execution);
    return {
      userId: reader.userId,
      outcome: { kind: "observed", watched, scopedAccess: reader.verifyAccess },
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
  execution: WatchExecution,
) {
  await watchCheckpoint(execution);
  const batch = await prepareWatchBatch(context, mediaId, options, execution);
  if (batch === null)
    return {
      status: "superseded",
      complete: false,
      reason: "requester_watch_unknown",
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
  return {
    status: status === "committed" ? "observed" : "superseded",
    complete,
    reason,
  } as const;
}
