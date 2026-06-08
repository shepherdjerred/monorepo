import type { SnapshotFrom } from "xstate";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
import type { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { sourceLabel } from "@shepherdjerred/streambot/sources/source.ts";

type PlaybackSnapshot = SnapshotFrom<ReturnType<typeof createPlaybackMachine>>;

/**
 * Project a machine snapshot into the read-only {@link PlaybackView} the command handler renders
 * (now-playing, queue, loop, volume). Shared by every per-session command handle and the e2e harness
 * so the projection lives in exactly one place.
 */
export function buildPlaybackView(snapshot: PlaybackSnapshot): PlaybackView {
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
          },
    queue: context.queue.map((entry) => ({
      title: sourceLabel(entry.source),
      requesterId: entry.requesterId,
    })),
    loop: context.loop,
    volume: context.volume,
  };
}
