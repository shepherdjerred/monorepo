import type { z } from "zod";
import type {
  PlaybackDecisionSchema,
  PlaybackStateSchema,
} from "#shared/household/playback.ts";
import type { Copy } from "./copy.ts";

/** What a stream is doing right now. */
export const PLAYBACK_STATE_COPY = {
  playing: { label: "Playing", tone: "ok" },
  paused: { label: "Paused", tone: "neutral" },
  buffering: { label: "Buffering", tone: "progress" },
  stopped: { label: "Stopped", tone: "neutral" },
} as const satisfies Record<z.infer<typeof PlaybackStateSchema>, Copy>;

/**
 * How Plex got a title to the screen it was watched on: untouched, in a
 * different wrapper, or converted to something the device can play.
 */
export const PLAYBACK_DECISION_COPY = {
  direct_play: "Played as it is",
  direct_stream: "Repackaged for the device",
  transcode: "Converted for the device",
  unknown: "Playback not recorded",
} as const satisfies Record<z.infer<typeof PlaybackDecisionSchema>, string>;

/** Whether a play reached the end, by the history's own mark for it. */
export const PLAY_FINISHED_COPY = {
  finished: { label: "Finished", tone: "ok" },
  partial: { label: "Partly watched", tone: "neutral" },
} as const satisfies Record<"finished" | "partial", Copy>;

/**
 * A play by a Plex account that is not matched to a household member. Only
 * the owner sees one. The words are the ones the statistics read already
 * uses for the same account in its ranking of people, so a page says it one
 * way.
 */
export const UNMATCHED_VIEWER = "Unmapped account";
