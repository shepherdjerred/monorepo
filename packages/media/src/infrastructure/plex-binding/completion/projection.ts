import type { PlexWatchProjection } from "#generated/prisma/client.ts";
import {
  BoundWatchAuthoritySchema,
  type BoundWatchAuthority,
} from "#shared/plex-binding/watch.ts";
import {
  NativeCompletionWindowSchema,
  PlexViewCountSchema,
} from "#shared/plex-binding/completion.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nextNativeCompletionWindow } from "#domain/household/completion.ts";
import { RETENTION_DEFAULTS } from "#domain/retention.ts";

export function parseWatchProjectionAuthority(row: PlexWatchProjection) {
  const stored = parsePlexRecord(
    BoundWatchAuthoritySchema,
    row.authority,
    row.authorityHash,
  );
  if (
    row.evidenceId !== stored.binding.evidenceId ||
    row.associationHash !== stored.binding.associationHash ||
    row.bindingRevision !== stored.binding.revision ||
    row.purpose !== stored.purpose ||
    row.mediaId !== stored.binding.scope.mediaId ||
    row.edition !== stored.binding.scope.edition ||
    row.source !== "plex"
  )
    throw new Error("Watch projection relational authority changed");
  return stored;
}

export function readNativeCompletionWindow(row: PlexWatchProjection) {
  if (
    row.completionPreviousObservedAt === null &&
    row.completionObservedAt === null
  )
    return null;
  const window = NativeCompletionWindowSchema.parse({
    previousObservedAt: row.completionPreviousObservedAt,
    completedObservedAt: row.completionObservedAt,
  });
  if (
    row.viewCount === null ||
    PlexViewCountSchema.parse(row.viewCount) === 0 ||
    !row.watched ||
    window.completedObservedAt > row.observedAt
  )
    throw new Error("Native completion window differs from its watch snapshot");
  return window;
}

export function nextProjectionCompletion(input: {
  previous: PlexWatchProjection | null;
  authority: BoundWatchAuthority;
  settledRevision: bigint;
  observedAt: Date;
  watched: boolean;
  viewCount: number | null;
  now: number;
}) {
  const previous = input.previous;
  const stored =
    previous === null ? null : parseWatchProjectionAuthority(previous);
  const priorWindow =
    previous === null ? null : readNativeCompletionWindow(previous);
  const window = nextNativeCompletionWindow({
    current: {
      watched: input.watched,
      viewCount: input.viewCount,
      observedAt: input.observedAt.getTime(),
    },
    previous:
      previous === null
        ? null
        : {
            watched: previous.watched,
            viewCount: previous.viewCount,
            observedAt: previous.observedAt.getTime(),
            window:
              priorWindow === null
                ? null
                : {
                    previousObservedAt:
                      priorWindow.previousObservedAt.getTime(),
                    completedObservedAt:
                      priorWindow.completedObservedAt.getTime(),
                  },
          },
    sameAuthority:
      stored !== null && identityHash(stored) === identityHash(input.authority),
    previousSettled: previous?.watchBatchRevision === input.settledRevision,
    now: input.now,
    maximumAgeMs: RETENTION_DEFAULTS.maximumWatchAgeMs,
  });
  return {
    viewCount: input.viewCount,
    completionPreviousObservedAt:
      window === null ? null : new Date(window.previousObservedAt),
    completionObservedAt:
      window === null ? null : new Date(window.completedObservedAt),
  };
}
