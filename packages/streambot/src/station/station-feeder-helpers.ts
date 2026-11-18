import { toRecordMedia } from "@shepherdjerred/streambot/commands/playback-recording.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import type { PlaybackContext } from "@shepherdjerred/streambot/machine/types.ts";
import {
  sourceIdentity,
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { PersistedStation } from "@shepherdjerred/streambot/state/station-schema.ts";
import type { CuratedStationItem } from "./station-types.ts";

export function snapshotStateName(snapshot: {
  readonly value: unknown;
}): string {
  return typeof snapshot.value === "string" ? snapshot.value : "unknown";
}

export function collectActiveExclusions(
  context: PlaybackContext,
  station: PersistedStation,
): { excludeIdentities: Set<string>; excludeWorkKeys: Set<string> } {
  const excludeIdentities = new Set<string>([
    ...station.recentIdentities,
    ...station.skippedIdentities,
  ]);
  const excludeWorkKeys = new Set<string>();
  const activeItems = [
    ...(context.current === null ? [] : [context.current]),
    ...context.queue,
  ];
  for (const entry of activeItems) {
    excludeIdentities.add(sourceIdentity(entry.source));
    const title = entry.display?.title ?? sourceLabel(entry.source);
    const workKey = canonicalWorkKey(title);
    if (workKey !== "") excludeWorkKeys.add(workKey);
  }
  return { excludeIdentities, excludeWorkKeys };
}

export function isSessionStillOnStation(
  session: {
    readonly torndown: boolean;
    readonly station: PersistedStation | undefined;
  },
  expectedKind: PersistedStation["kind"],
  signal: AbortSignal,
): boolean {
  return (
    !signal.aborted &&
    !session.torndown &&
    session.station?.kind === expectedKind
  );
}

export function recordStationHistoryRequest(input: {
  readonly history: MediaHistoryStore | undefined;
  readonly historyAllowed: boolean;
  readonly scope: { guildId: string; channelId: string; userId: string };
  readonly station: PersistedStation;
  readonly source: Source;
  readonly item: CuratedStationItem;
}): string | undefined {
  if (!input.historyAllowed || input.history === undefined) return undefined;
  const identity = sourceIdentity(input.source);
  return input.history.recordQueueRequest({
    scope: input.scope,
    rawQuery:
      input.station.seed === undefined
        ? `${input.station.kind}:${input.station.scope}`
        : `${input.station.kind}:${input.station.seed}`,
    intent: inferMediaIntent({ query: input.item.title, placement: "queue" }),
    media: toRecordMedia(input.source, undefined, {
      token: identity,
      provider: input.source.kind === "file" ? "local" : "youtube",
      title: input.item.title,
      source: input.source,
      score: 100,
      reason: input.station.kind,
      ...(input.item.channel === undefined
        ? {}
        : { channel: input.item.channel }),
      ...(input.item.thumbnailUrl === undefined
        ? {}
        : { thumbnailUrl: input.item.thumbnailUrl }),
      ...(input.item.durationSeconds === undefined
        ? {}
        : { durationSeconds: input.item.durationSeconds }),
    }),
  });
}
