import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type {
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { MediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { RecordMedia } from "@shepherdjerred/streambot/history/media-history.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";

export async function recordRequest(input: {
  readonly deps: PlaybackCommandServiceDeps;
  readonly scope: DiscoveryScope | null;
  readonly query: string;
  readonly intent: MediaIntent;
  readonly media: RecordMedia;
}): Promise<string | undefined> {
  const { deps, scope, query, intent, media } = input;
  if (scope === null || deps.history === undefined) return undefined;
  const enabled =
    deps.featureGate === undefined || (await deps.featureGate.history(scope));
  return enabled
    ? deps.history.recordQueueRequest({ scope, rawQuery: query, intent, media })
    : undefined;
}

export async function recordFailed(input: {
  readonly deps: PlaybackCommandServiceDeps;
  readonly scope: DiscoveryScope;
  readonly query: string;
  readonly intent: MediaIntent;
  readonly errorCode: string;
}): Promise<void> {
  const { deps, scope, query, intent, errorCode } = input;
  if (
    deps.history === undefined ||
    (deps.featureGate !== undefined && !(await deps.featureGate.history(scope)))
  ) {
    return;
  }
  deps.history.recordQueueRequest({
    scope,
    rawQuery: query,
    intent,
    status: "failed",
    errorCode,
  });
}

export function markReplacedRequest(deps: PlaybackCommandServiceDeps): void {
  const requestId = deps.view().current?.requestId;
  if (requestId !== undefined)
    deps.history?.updateRequest(requestId, "skipped");
}

export function toRecordMedia(
  source: Source,
  resolved: ResolvedSource | undefined,
  candidate: MediaCandidate | undefined,
): RecordMedia {
  const provenance = resolved?.provenance;
  return {
    title: candidate?.title ?? resolved?.title ?? sourceLabel(source),
    provider: mediaProvider(source, candidate),
    source,
    canonicalUrl: candidate?.canonicalUrl ?? provenance?.canonicalUrl,
    channel: candidate?.channel ?? provenance?.channel,
    thumbnailUrl: candidate?.thumbnailUrl ?? provenance?.thumbnailUrl,
    durationSeconds: candidate?.durationSeconds ?? resolved?.durationSeconds,
  };
}

function mediaProvider(
  source: Source,
  candidate: MediaCandidate | undefined,
): RecordMedia["provider"] {
  return source.kind === "file" || candidate?.provider === "local"
    ? "local"
    : "youtube";
}
