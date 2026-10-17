import type { MediaAutomationContext } from "./context.ts";
import { serializable } from "./store.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import { lockWatchAuthority, watchScope } from "./plex-events/authority.ts";
import * as watchAuthority from "./plex-events/authority.ts";
import { observeWatchBatch } from "./plex-events/observe.ts";
import { queueCurrentRetention } from "./plex-events/finalize.ts";
import { watchCheckpoint } from "./plex-events/execution.ts";

/** Current requester-scoped reads; atomic ordering applies equally to polling and hints. */
export async function observeRequesterWatch(
  context: MediaAutomationContext,
  mediaId: string,
  options: { expectedHint?: ObservePlexHintInput } = {},
): Promise<{ complete: boolean; reason: string | null }> {
  const execution = context.watchExecution();
  const result = await observeWatchBatch(context, mediaId, options, execution);
  return { complete: result.complete, reason: result.reason };
}

export async function queueRetentionCheck(
  context: MediaAutomationContext,
  mediaId: string,
  bucket: string,
): Promise<void> {
  const execution = context.watchExecution();
  await watchCheckpoint(execution);
  const scope = await watchScope(context, mediaId, {}, execution);
  await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, execution);
    if (authority === null) return;
    await queueCurrentRetention(tx, authority, bucket, execution);
  });
}
export const PlexIdentitySchema = watchAuthority.PlexIdentitySchema;
