import type { SnapshotFrom } from "xstate";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
import type { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";

type PlaybackSnapshot = SnapshotFrom<ReturnType<typeof createPlaybackMachine>>;

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
  return {
    state:
      typeof snapshot.value === "string"
        ? snapshot.value
        : JSON.stringify(snapshot.value),
    current:
      context.current === null
        ? null
        : {
            title:
              context.resolved?.title ?? sourceLabel(context.current.source),
            requesterId: context.current.requesterId,
            chapters: context.resolved?.chapters ?? [],
          },
    queue: context.queue.map((entry) => ({
      title: sourceLabel(entry.source),
      requesterId: entry.requesterId,
      chapters: [],
    })),
    loop: context.loop,
    volume: context.volume,
    positionSeconds,
  };
}
