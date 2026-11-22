import type { z } from "zod";
import type { PlaybackStateSchema } from "#shared/household/playback.ts";
import type { Copy } from "./copy.ts";

/** What a stream is doing right now. */
export const PLAYBACK_STATE_COPY = {
  playing: { label: "Playing", tone: "ok" },
  paused: { label: "Paused", tone: "neutral" },
  buffering: { label: "Loading", tone: "progress" },
  stopped: { label: "Stopped", tone: "neutral" },
} as const satisfies Record<z.infer<typeof PlaybackStateSchema>, Copy>;

/**
 * Who is watching, when Plex reports an account Media has no person for:
 * someone the library is shared with outside the household.
 */
export const UNKNOWN_VIEWER = "Someone else";
