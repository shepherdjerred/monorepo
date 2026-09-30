import type { SnapshotFrom } from "xstate";
import type { Chapter } from "@shepherdjerred/streambot/sources/chapters.ts";
import type { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  sourceIdentity,
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { MediaKind } from "@shepherdjerred/streambot/sources/media-kind.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

type PlaybackSnapshot = SnapshotFrom<ReturnType<typeof createPlaybackMachine>>;

export type QueueItemView = {
  readonly title: string;
  readonly requesterId: UserId;
  /** Chapter markers of this item (only populated for the currently-playing item). */
  readonly chapters: readonly Chapter[];
  /** Source kind — the player card only looks up TMDB posters for local files. */
  readonly kind: Source["kind"];
  /**
   * Transport this item resolved to, once it has been resolved. Null before resolution, and for
   * queued items, because the kind is only known after the classifier and the final probe have
   * both run. Drives the card's badge and disables the subtitle picker for audio-only items —
   * `prepareStream` hard-throws when `subtitleBurn` meets `audioOnly`, so offering the button on a
   * music item would hand the user a guaranteed failure.
   */
  readonly mediaKind: MediaKind | null;
  /**
   * Stable identity of the underlying source (`file:<path>` / `url:<url>` / `search:<query>`). The
   * player card keys its lifecycle on this rather than the display title, so two different files
   * that happen to share a title get their own cards, and a title that changes as a source resolves
   * doesn't look like a new track.
   */
  readonly sourceId: string;
  /**
   * Media duration in seconds from the resolve-time ffprobe, or null when unknown (live streams,
   * probe failure) or for a not-yet-resolved queue entry. Drives the player card's progress bar,
   * which falls back to an elapsed-only readout when this is null.
   */
  readonly durationSeconds: number | null;
  readonly requestId?: string;
  readonly provenance?: ResolvedSource["provenance"];
  readonly source?: Source;
};

/**
 * The read-only projection of a playback snapshot that every transport renders.
 *
 * It lives beside the projection that produces it rather than beside the Discord text builders
 * that consume it: the machine owns what a playback state looks like from outside, and the
 * transports are downstream of that. Declaring it in `discord/` inverted the dependency and made
 * the core reach back into a transport for the shape of its own output.
 */
export type PlaybackView = {
  readonly state: string;
  readonly current: QueueItemView | null;
  readonly queue: readonly QueueItemView[];
  readonly loop: string;
  readonly volume: number;
  /** Live elapsed seconds since playback began (segment offset + wall-clock). Null when idle/between segments. */
  readonly positionSeconds: number | null;
  readonly paused?: boolean;
  readonly listening?: boolean;
};

/**
 * Project a machine snapshot into the read-only {@link PlaybackView} the command handler renders
 * (now-playing, queue, loop, volume). Shared by every per-session command handle and the e2e harness
 * so the projection lives in exactly one place. `positionSeconds` is the streamer's live elapsed
 * time — passed in because it lives outside the XState context (it's wall-clock, not state).
 */
export function buildPlaybackView(
  snapshot: PlaybackSnapshot,
  positionSeconds: number | null,
): PlaybackView {
  const { context } = snapshot;
  const state =
    typeof snapshot.value === "string"
      ? snapshot.value
      : JSON.stringify(snapshot.value);
  return {
    state,
    current:
      context.current === null
        ? null
        : {
            title:
              context.resolved?.title ?? sourceLabel(context.current.source),
            requesterId: context.current.requesterId,
            chapters: context.resolved?.chapters ?? [],
            kind: context.current.source.kind,
            mediaKind: context.resolved?.mediaKind ?? null,
            sourceId: sourceIdentity(context.current.source),
            durationSeconds: context.resolved?.durationSeconds ?? null,
            ...(context.current.requestId === undefined
              ? {}
              : { requestId: context.current.requestId }),
            ...(context.resolved?.provenance === undefined
              ? {}
              : { provenance: context.resolved.provenance }),
            source: context.current.source,
          },
    queue: context.queue.map((entry) => ({
      title: sourceLabel(entry.source),
      requesterId: entry.requesterId,
      chapters: [],
      kind: entry.source.kind,
      mediaKind: null,
      sourceId: sourceIdentity(entry.source),
      durationSeconds: null,
      ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
      source: entry.source,
    })),
    loop: context.loop,
    volume: context.volume,
    positionSeconds:
      state === "paused" ? context.pausedPositionSeconds : positionSeconds,
    paused: state === "paused",
    listening: state === "waiting" && context.current === null,
  };
}
