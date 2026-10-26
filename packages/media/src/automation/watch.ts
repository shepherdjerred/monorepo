import type { MediaAutomationContext } from "./context.ts";
import { serializable } from "./store.ts";
import type { ObservePlexHintInput } from "#shared/plex-events/contract.ts";
import { lockWatchAuthority, watchScope } from "./plex-events/authority.ts";
import * as watchAuthority from "./plex-events/authority.ts";
import { observeWatchBatch } from "./plex-events/observe.ts";
import { queueCurrentRetention } from "./plex-events/finalize.ts";
import { watchCheckpoint } from "./plex-events/execution.ts";
import {
  plexBindingFreshness,
  bindPlexTransactionDeadline,
} from "#infrastructure/plex-binding/freshness.ts";
import { watchDeadline } from "./plex-events/deadline.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";

/** Current requester-scoped reads; atomic ordering applies equally to polling and hints. */
export async function observeRequesterWatch(
  context: MediaAutomationContext,
  mediaId: string,
  options: { expectedHint?: ObservePlexHintInput } = {},
  captureFreshness?: (freshness: PlexBindingFreshness) => void,
): Promise<{ complete: boolean; reason: string | null }> {
  const execution = context.plexBindingExecution();
  const result = await observeWatchBatch(context, mediaId, options, execution);
  if (result.freshness !== null) captureFreshness?.(result.freshness);
  return { complete: result.complete, reason: result.reason };
}

export async function queueRetentionCheck(
  context: MediaAutomationContext,
  mediaId: string,
  bucket: string,
): Promise<void> {
  const execution = context.plexBindingExecution();
  const freshness = plexBindingFreshness({ ...execution, guards: [execution] });
  const active = {
    ...execution,
    assertActive: () => {
      freshness.assertActive();
    },
  };
  await watchCheckpoint(active);
  const scope = await watchScope(context, mediaId, {}, active);
  await serializable(context.db, async (tx) => {
    const authority = await lockWatchAuthority(tx, scope, active);
    if (authority?.binding == null) return;
    const deadline = await watchDeadline(tx, authority, execution);
    await bindPlexTransactionDeadline(tx, deadline);
    await queueCurrentRetention(tx, authority, bucket, {
      ...execution,
      assertActive: () => {
        deadline.assertActive();
      },
    });
  });
}
export const PlexIdentitySchema = watchAuthority.PlexIdentitySchema;
