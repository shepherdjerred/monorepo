import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";
import type { PlaybackContext } from "@shepherdjerred/streambot/machine/types.ts";
import type { StatusSnapshot } from "@shepherdjerred/streambot/discord/status-reporter.ts";

/**
 * Project a machine snapshot into the reporter's {@link StatusSnapshot} plus the flat state name
 * used for logs/metrics. Extracted from the session manager's actor subscription so the mapping
 * is testable and the subscription stays readable.
 */
export function describeSnapshot(snapshot: {
  value: unknown;
  context: PlaybackContext;
}): { stateName: string; snap: StatusSnapshot } {
  const stateValue = snapshot.value;
  const stateName =
    typeof stateValue === "string" ? stateValue : JSON.stringify(stateValue);
  const currentSource = snapshot.context.current?.source ?? null;
  return {
    stateName,
    snap: {
      state: stateName,
      currentKind: currentSource?.kind ?? null,
      // Available during `resolving` (before a title is known) so the "preparing…" notice can name it.
      currentSourceLabel:
        currentSource === null ? null : sourceLabel(currentSource),
      blockedNonce: snapshot.context.blockedNonce,
      blockedRequester: snapshot.context.lastBlockedRequester,
      lastError: snapshot.context.lastError,
      crashNotice: snapshot.context.crashNotice,
    },
  };
}
