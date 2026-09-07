import type { PlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

/**
 * The playback view both player-surface suites render from.
 *
 * `player-card` asserts what the card looks like and `player-controls` asserts who may press its
 * buttons, so they need the same item in the same state but assert different things about it.
 * Keeping one fixture means a change to `PlaybackView` is a one-file edit rather than two copies
 * that drift the moment one is updated.
 */
export const VIEW_REQUESTER = UserIdSchema.parse("100000000000000002");

export const VIEW_CHAPTERS = [
  { index: 1, title: "Intro", startSeconds: 0, endSeconds: 90 },
  { index: 2, title: "The Heist", startSeconds: 90, endSeconds: 600 },
];

export function playerView(over: Partial<PlaybackView> = {}): PlaybackView {
  return {
    state: "streaming",
    current: {
      title: "Heat (1995)",
      requesterId: VIEW_REQUESTER,
      chapters: VIEW_CHAPTERS,
      kind: "file",
      mediaKind: null,
      sourceId: "file:Heat (1995)",
      durationSeconds: 600,
    },
    queue: [],
    loop: "off",
    volume: 100,
    positionSeconds: 300,
    ...over,
  };
}
